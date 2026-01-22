document.addEventListener('DOMContentLoaded', () => {
    // Sidebar elements
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const navItems = document.querySelectorAll('.nav-item');
    const views = document.querySelectorAll('.view');

    // Case browser elements
    const fileList = document.getElementById('file-list');
    const caseFrame = document.getElementById('case-frame');
    const runBtn = document.getElementById('run-btn');
    const repeatBtn = document.getElementById('repeat-btn');
    const tabStage1 = document.getElementById('tab-stage1');
    const tabStage2 = document.getElementById('tab-stage2');
    const stage1Output = document.getElementById('stage1-output');
    const stage2Output = document.getElementById('stage2-output');
    
    // Case extraction elements
    const totalCasesEl = document.getElementById('total-cases');
    const processedCasesEl = document.getElementById('processed-cases');
    const limitInput = document.getElementById('limit-input');
    const batchRunBtn = document.getElementById('batch-run-btn');
    const batchRunStage2Btn = document.getElementById('batch-run-stage2-btn');
    const progressLog = document.getElementById('progress-log');
    const progressBarContainer = document.getElementById('progress-bar-container');
    const progressBar = document.getElementById('progress-bar');
    const progressStats = document.getElementById('progress-stats');

    let selectedFile = null;
    let abortController = null;
    let batchAbortController = null;
    let batchStage2AbortController = null;
    let statusAbortController = null;
    
    // Track stage completion for the selected file
    let stage1Complete = false;
    let stage2Complete = false;
    let currentStage = 1; // Which stage the run button will execute

    repeatBtn.hidden = true;
    tabStage1.disabled = true;
    tabStage2.disabled = true;

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatStage2Value(value) {
        if (value === null || value === undefined || value === '') {
            return '<span class="stage2-muted">None</span>';
        }

        if (Array.isArray(value)) {
            if (!value.length) {
                return '<span class="stage2-muted">None</span>';
            }
            return value
                .map(item => `<span class="stage2-pill">${escapeHtml(item)}</span>`)
                .join('');
        }

        if (typeof value === 'object') {
            return `<span>${escapeHtml(JSON.stringify(value))}</span>`;
        }

        return `<span>${escapeHtml(value)}</span>`;
    }

    function formatStage2Output(data) {
        if (!data) {
            return '';
        }

        const caseType = data.case_type ? data.case_type.toUpperCase() : 'UNKNOWN';
        const sections = [];

        // Add legal issues section
        if (data.issues && data.issues.length) {
            const issuesList = data.issues
                .map(issue => `<li>${escapeHtml(issue)}</li>`)
                .join('');
            sections.push(
                `<div class="stage2-section"><div class="stage2-section-title">Legal Issues</div><ul class="stage2-issues">${issuesList}</ul></div>`
            );
        }

        const addDetails = (obj) => {
            if (!obj) {
                return;
            }
            const rows = Object.entries(obj).map(([key, value]) => {
                const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                return `<div class="stage2-row"><dt>${escapeHtml(label)}</dt><dd>${formatStage2Value(value)}</dd></div>`;
            });
            sections.push(`<dl class="stage2-list">${rows.join('')}</dl>`);
        };

        addDetails(data.criminal);
        addDetails(data.civil);

        return `<div class="stage2-card"><div class="stage2-header"><span class="stage2-label">Case Type</span><span class="stage2-badge">${escapeHtml(caseType)}</span></div>${sections.join('')}</div>`;
    }

    function setActiveTab(stage) {
        const isStage2 = stage === 'stage2';
        tabStage1.classList.toggle('active', !isStage2);
        tabStage2.classList.toggle('active', isStage2);
        stage1Output.classList.toggle('active', !isStage2);
        stage2Output.classList.toggle('active', isStage2);
        updateRepeatButtonVisibility();
    }

    function updateRepeatButtonVisibility() {
        const isStage2Active = tabStage2.classList.contains('active');
        if (isStage2Active && stage2Complete) {
            repeatBtn.hidden = false;
            repeatBtn.textContent = 'Repeat stage 2';
        } else if (!isStage2Active && stage1Complete) {
            repeatBtn.hidden = false;
            repeatBtn.textContent = 'Repeat stage 1';
        } else {
            repeatBtn.hidden = true;
        }
    }

    function updateRunButton() {
        if (!stage1Complete) {
            currentStage = 1;
            runBtn.textContent = 'Run stage 1';
            runBtn.disabled = false;
            runBtn.hidden = false;
        } else if (!stage2Complete) {
            currentStage = 2;
            runBtn.textContent = 'Run stage 2';
            runBtn.disabled = false;
            runBtn.hidden = false;
        } else {
            runBtn.hidden = true;
        }
    }

    tabStage1.addEventListener('click', () => setActiveTab('stage1'));
    tabStage2.addEventListener('click', () => setActiveTab('stage2'));

    // Sidebar toggle
    sidebarToggle.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
    });

    // Case Atlas elements
    const atlasFiltersContainer = document.getElementById('atlas-filters');
    const atlasAddFilterBtn = document.getElementById('atlas-add-filter');
    const atlasContent = document.getElementById('atlas-content');
    let atlasCases = [];
    let atlasFilterCount = 0;
    
    const CRIMINAL_FIELDS = ['offense_severity', 'charges', 'weapon_type', 'victim_count', 'evidence_types', 'aggravating_factors', 'prior_record_severity'];
    const CIVIL_FIELDS = ['cause_of_action', 'duty_of_care_source', 'breach_description', 'proximate_causation_score', 'damages_claimed', 'is_settlement'];

    const FILTER_OPTIONS_HTML = `
        <option value="">Select grouping...</option>
        <optgroup label="General">
            <option value="case_type">Case Type</option>
        </optgroup>
        <optgroup label="Criminal">
            <option value="offense_severity">Offense Severity</option>
            <option value="charges">Charges</option>
            <option value="weapon_type">Weapon Type</option>
            <option value="victim_count">Victim Count</option>
            <option value="evidence_types">Evidence Types</option>
            <option value="aggravating_factors">Aggravating Factors</option>
            <option value="prior_record_severity">Prior Record Severity</option>
        </optgroup>
        <optgroup label="Civil">
            <option value="cause_of_action">Cause of Action</option>
            <option value="duty_of_care_source">Duty of Care Source</option>
            <option value="breach_description">Breach Description</option>
            <option value="proximate_causation_score">Proximate Causation Score</option>
            <option value="damages_claimed">Damages Claimed</option>
            <option value="is_settlement">Settlement</option>
        </optgroup>
    `;

    function createFilterElement(filterId, showRemove = false) {
        const wrapper = document.createElement('div');
        wrapper.className = 'atlas-filter-item';
        wrapper.dataset.filterId = filterId;

        const select = document.createElement('select');
        select.className = 'atlas-filter-select';
        select.innerHTML = FILTER_OPTIONS_HTML;
        select.addEventListener('change', onAtlasFilterChange);

        wrapper.appendChild(select);

        if (showRemove) {
            const removeBtn = document.createElement('button');
            removeBtn.className = 'atlas-filter-btn atlas-remove-btn';
            removeBtn.title = 'Remove grouping';
            removeBtn.textContent = '−';
            removeBtn.addEventListener('click', () => removeAtlasFilter(filterId));
            wrapper.appendChild(removeBtn);
        }

        return wrapper;
    }

    function updateFilterDropdowns() {
        const allSelects = atlasFiltersContainer.querySelectorAll('.atlas-filter-select');
        const selectedValues = Array.from(allSelects).map(s => s.value).filter(v => v !== '');
        
        // Determine if a case-type-specific filter is selected (exclude empty values)
        const hasCriminalFilter = selectedValues.some(v => CRIMINAL_FIELDS.includes(v));
        const hasCivilFilter = selectedValues.some(v => CIVIL_FIELDS.includes(v));
        
        allSelects.forEach((select, idx) => {
            const currentValue = select.value;
            const otherSelectedValues = selectedValues.filter(v => v !== currentValue);
            
            select.querySelectorAll('option').forEach(option => {
                const val = option.value;
                // Never hide the placeholder option
                if (val === '') {
                    option.disabled = false;
                    option.style.display = '';
                    return;
                }
                
                // Hide if already selected by another filter
                let shouldHide = otherSelectedValues.includes(val);
                
                // Hide opposite case type options (but not from the dropdown that has the current value)
                if (!shouldHide && hasCriminalFilter && CIVIL_FIELDS.includes(val)) {
                    shouldHide = true;
                }
                if (!shouldHide && hasCivilFilter && CRIMINAL_FIELDS.includes(val)) {
                    shouldHide = true;
                }
                
                if (shouldHide) {
                    option.disabled = true;
                    option.style.display = 'none';
                } else {
                    option.disabled = false;
                    option.style.display = '';
                }
            });
        });
    }

    function addAtlasFilter() {
        atlasFilterCount++;
        const isFirst = atlasFiltersContainer.children.length === 0;
        const filterEl = createFilterElement(atlasFilterCount, !isFirst);
        atlasFiltersContainer.appendChild(filterEl);
        
        updateFilterDropdowns();
    }

    function removeAtlasFilter(filterId) {
        const filterEl = atlasFiltersContainer.querySelector(`[data-filter-id="${filterId}"]`);
        if (filterEl) {
            filterEl.remove();
        }
        updateFilterDropdowns();
        onAtlasFilterChange();
    }

    function getActiveFilters() {
        const filters = [];
        atlasFiltersContainer.querySelectorAll('.atlas-filter-select').forEach(select => {
            filters.push(select.value);
        });
        return filters;
    }

    function onAtlasFilterChange() {
        updateFilterDropdowns();
        const filters = getActiveFilters();
        const allFiltersValid = filters.length > 0 && filters.every(f => f !== '');
        if (atlasCases.length && allFiltersValid) {
            atlasContent.innerHTML = '';
            setTimeout(() => renderAtlasGrid(filters), 50);
        }
    }

    // Initialize first filter and add button handler
    addAtlasFilter();
    atlasAddFilterBtn.addEventListener('click', addAtlasFilter);

    // View switching
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const viewId = item.dataset.view;
            
            // Update nav items
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            
            // Update views
            views.forEach(view => view.classList.remove('active'));
            document.getElementById(`${viewId}-view`).classList.add('active');
            
            // Load batch status when switching to extraction view
            if (viewId === 'case-extraction') {
                loadBatchStatus();
            }
            // Load atlas when switching to atlas view
            if (viewId === 'case-atlas') {
                loadAtlasCases();
            }
        });
    });

    // Fetch and display file list
    fetch('/api/files')
        .then(response => response.json())
        .then(files => {
            files.forEach(file => {
                const div = document.createElement('div');
                div.className = 'file-item';
                div.textContent = file;
                div.onclick = () => selectFile(file, div);
                fileList.appendChild(div);
            });
            if (files.length) {
                const firstItem = fileList.querySelector('.file-item');
                if (firstItem) {
                    selectFile(files[0], firstItem);
                }
            }
        })
        .catch(err => console.error('Error fetching files:', err));

    function selectFile(filename, element) {
        // Update UI selection
        document.querySelectorAll('.file-item').forEach(el => el.classList.remove('selected'));
        element.classList.add('selected');
        
        selectedFile = filename;
        stage1Complete = false;
        stage2Complete = false;
        runBtn.disabled = true;
        runBtn.hidden = false;
        runBtn.textContent = 'Run stage 1';
        repeatBtn.hidden = true;
        tabStage1.disabled = true;
        tabStage2.disabled = true;
        setActiveTab('stage1');
        
        // Load HTML content
        caseFrame.src = `/api/html/${filename}`;
        
        // Clear previous analysis
        stage1Output.innerHTML = '';
        stage2Output.innerHTML = '';
        if (abortController) {
            abortController.abort();
            abortController = null;
            runBtn.textContent = 'Run stage 1';
        }
        if (statusAbortController) {
            statusAbortController.abort();
            statusAbortController = null;
        }

        // Check stage 1 + stage 2 outputs before enabling run
        const currentFile = filename;
        statusAbortController = new AbortController();
        const { signal } = statusAbortController;
        Promise.all([
            fetch(`/api/output/exists/${filename}`, { signal }).then(response => {
                if (response.ok) {
                    return response.json();
                }
                return { exists: false };
            }),
            fetch(`/api/output_stage2/exists/${filename}`, { signal }).then(response => {
                if (response.ok) {
                    return response.json();
                }
                return { exists: false };
            })
        ])
            .then(([stage1Status, stage2Status]) => {
                if (signal.aborted || selectedFile !== currentFile) {
                    return null;
                }
                stage1Complete = stage1Status.exists === true;
                stage2Complete = stage2Status.exists === true;

                tabStage1.disabled = !stage1Complete;
                tabStage2.disabled = !stage2Complete;

                updateRunButton();
                updateRepeatButtonVisibility();

                const stage1Fetch = stage1Complete
                    ? fetch(`/api/output/${filename}`, { signal }).then(response => {
                          if (response.ok) {
                              return response.text();
                          }
                          return null;
                      })
                    : Promise.resolve(null);

                const stage2Fetch = stage2Complete
                    ? fetch(`/api/output_stage2/${filename}`, { signal }).then(response => {
                          if (response.ok) {
                              return response.json();
                          }
                          return null;
                      })
                    : Promise.resolve(null);

                return Promise.all([stage1Fetch, stage2Fetch]).then(([html, stage2]) => {
                    if (signal.aborted || selectedFile !== currentFile) {
                        return null;
                    }
                    return { html, stage2 };
                });
            })
            .then(result => {
                if (!result) {
                    return;
                }

                const { html, stage2 } = result;
                if (html) {
                    stage1Output.innerHTML = html;
                }
                if (stage2) {
                    stage2Output.innerHTML = formatStage2Output(stage2);
                }

                if (stage2Complete) {
                    setActiveTab('stage2');
                } else if (stage1Complete) {
                    setActiveTab('stage1');
                }

                const outputContainer = document.getElementById('analysis-output');
                outputContainer.scrollTop = outputContainer.scrollHeight;
            })
            .catch(err => {
                if (err.name === 'AbortError') {
                    return;
                }
                console.log('Cache check failed:', err);
                stage1Complete = false;
                stage2Complete = false;
                updateRunButton();
                updateRepeatButtonVisibility();
            });
    }

    runBtn.onclick = async () => {
        if (!selectedFile) return;

        if (abortController) {
            abortController.abort();
            abortController = null;
            updateRunButton();
            return;
        }

        if (currentStage === 1) {
            await runStage1();
        } else {
            await runStage2();
        }
    };

    async function runStage1() {
        stage1Output.innerHTML = '<p>Thinking...</p>';
        runBtn.textContent = 'Stop';
        repeatBtn.hidden = true;
        abortController = new AbortController();

        let analysisSucceeded = false;
        try {
            const response = await fetch(`/api/analyze/${selectedFile}`, {
                method: 'POST',
                signal: abortController.signal
            });

            if (!response.ok) {
                throw new Error(`Request failed (${response.status})`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let html = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                const chunk = decoder.decode(value, { stream: true });
                html += chunk;
            }
            
            stage1Output.innerHTML = html;
            const outputContainer = document.getElementById('analysis-output');
            outputContainer.scrollTop = outputContainer.scrollHeight;
            analysisSucceeded = true;
        } catch (err) {
            if (err.name === 'AbortError') {
                stage1Output.innerHTML += '<p>[Analysis stopped]</p>';
            } else {
                stage1Output.innerHTML = `<p>Error: ${err.message}</p>`;
            }
        } finally {
            if (analysisSucceeded) {
                stage1Complete = true;
                tabStage1.disabled = false;
                setActiveTab('stage1');
            }
            updateRunButton();
            updateRepeatButtonVisibility();
            abortController = null;
        }
    }

    async function runStage2() {
        stage2Output.innerHTML = '<p class="stage2-muted">Thinking...</p>';
        runBtn.textContent = 'Stop';
        repeatBtn.hidden = true;
        abortController = new AbortController();

        try {
            const response = await fetch(`/api/analyze_stage2/${selectedFile}`, {
                method: 'POST',
                signal: abortController.signal
            });

            if (!response.ok) {
                const detail = await response.text();
                throw new Error(detail || `Request failed (${response.status})`);
            }

            const data = await response.json();
            stage2Output.innerHTML = formatStage2Output(data);
            const outputContainer = document.getElementById('analysis-output');
            outputContainer.scrollTop = outputContainer.scrollHeight;
            stage2Complete = true;
            tabStage2.disabled = false;
            setActiveTab('stage2');
        } catch (err) {
            if (err.name === 'AbortError') {
                stage2Output.innerHTML += '<p class="stage2-muted">[Stage 2 stopped]</p>';
            } else {
                stage2Output.innerHTML = `<p class="stage2-error">Error: ${escapeHtml(err.message)}</p>`;
            }
        } finally {
            updateRunButton();
            updateRepeatButtonVisibility();
            abortController = null;
        }
    }

    repeatBtn.onclick = async () => {
        if (!selectedFile) return;

        const isStage2Active = tabStage2.classList.contains('active');
        
        if (isStage2Active) {
            // Repeat stage 2
            stage2Complete = false;
            updateRunButton();
            updateRepeatButtonVisibility();
            await runStage2();
        } else {
            // Repeat stage 1 - need to delete stage 2 output if it exists
            if (stage2Complete) {
                try {
                    await fetch(`/api/output_stage2/${selectedFile}`, { method: 'DELETE' });
                } catch (err) {
                    console.error('Failed to delete stage 2 output:', err);
                }
                stage2Complete = false;
                stage2Output.innerHTML = '';
                tabStage2.disabled = true;
            }
            stage1Complete = false;
            updateRunButton();
            updateRepeatButtonVisibility();
            await runStage1();
        }
    };

    // Batch processing functions
    async function loadBatchStatus() {
        try {
            const response = await fetch('/api/batch/status');
            const data = await response.json();
            totalCasesEl.textContent = data.total;
            processedCasesEl.textContent = data.stage1_processed;
            const stage1Complete = data.stage1_complete === true;
            const stage2Complete = data.stage2_complete === true;
            batchRunBtn.disabled = stage1Complete;
            batchRunStage2Btn.disabled = !stage1Complete || stage2Complete;
        } catch (err) {
            console.error('Error loading batch status:', err);
            totalCasesEl.textContent = '--';
            processedCasesEl.textContent = '--';
        }
    }

    batchRunBtn.onclick = async () => {
        if (batchAbortController) {
            batchAbortController.abort();
            batchAbortController = null;
            batchRunBtn.textContent = 'Run stage 1 batch extraction';
            return;
        }

        progressLog.innerHTML = '';
        progressBar.style.width = '0%';
        progressStats.textContent = 'Starting...';
        batchRunBtn.textContent = 'Stop';
        batchRunStage2Btn.disabled = true;
        batchAbortController = new AbortController();

        const limit = limitInput.value ? parseInt(limitInput.value) : null;
        
        let totalToProcess = 0;
        let currentProgress = 0;

        try {
            const response = await fetch('/api/batch/run', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ limit }),
                signal: batchAbortController.signal
            });

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n');
                
                lines.forEach(line => {
                    if (line.startsWith('data: ')) {
                        const message = line.substring(6);
                        if (message) {
                            const p = document.createElement('p');
                            p.className = 'log-entry';
                            
                            // Parse total from "Found X cases. Processing Y..." message
                            const foundMatch = message.match(/Processing (\d+)\.\.\./);
                            if (foundMatch) {
                                totalToProcess = parseInt(foundMatch[1]);
                            }
                            
                            // Update progress on Completed or Skipped
                            if (message.includes('Completed') || message.includes('Skipped')) {
                                currentProgress++;
                                if (totalToProcess > 0) {
                                    const percent = Math.round((currentProgress / totalToProcess) * 100);
                                    progressBar.style.width = `${percent}%`;
                                    progressStats.textContent = `${currentProgress} of ${totalToProcess} (${percent}%)`;
                                }
                            }
                            
                            if (message.includes('Completed') || message.includes('Done.')) {
                                p.classList.add('success');
                            } else if (message.includes('Error')) {
                                p.classList.add('error');
                            } else if (message.includes('Skipped')) {
                                p.classList.add('skip');
                            } else if (message.includes('Found') || message.includes('Processing')) {
                                p.classList.add('info');
                            }
                            
                            // Mark completion
                            if (message.includes('Done.')) {
                                progressBar.style.width = '100%';
                                progressStats.textContent = 'Complete!';
                            }
                            
                            p.textContent = message;
                            progressLog.appendChild(p);
                            progressLog.scrollTop = progressLog.scrollHeight;
                        }
                    }
                });
            }
            
            // Refresh stats after completion
            loadBatchStatus();
        } catch (err) {
            if (err.name === 'AbortError') {
                const p = document.createElement('p');
                p.className = 'log-entry error';
                p.textContent = '[Batch processing stopped]';
                progressLog.appendChild(p);
                progressStats.textContent = 'Stopped';
            } else {
                const p = document.createElement('p');
                p.className = 'log-entry error';
                p.textContent = `Error: ${err.message}`;
                progressLog.appendChild(p);
                progressStats.textContent = 'Error';
            }
        } finally {
            batchRunBtn.textContent = 'Run stage 1 batch extraction';
            batchAbortController = null;
            loadBatchStatus();
        }
    };

    batchRunStage2Btn.onclick = async () => {
        if (batchStage2AbortController) {
            batchStage2AbortController.abort();
            batchStage2AbortController = null;
            batchRunStage2Btn.textContent = 'Run stage 2 batch extraction';
            return;
        }

        progressLog.innerHTML = '';
        progressBar.style.width = '0%';
        progressStats.textContent = 'Starting...';
        batchRunStage2Btn.textContent = 'Stop';
        batchRunBtn.disabled = true;
        batchStage2AbortController = new AbortController();

        const limit = limitInput.value ? parseInt(limitInput.value) : null;

        let totalToProcess = 0;
        let currentProgress = 0;

        try {
            const response = await fetch('/api/batch/run-stage2', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ limit }),
                signal: batchStage2AbortController.signal
            });

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n');

                lines.forEach(line => {
                    if (line.startsWith('data: ')) {
                        const message = line.substring(6);
                        if (message) {
                            const p = document.createElement('p');
                            p.className = 'log-entry';

                            const foundMatch = message.match(/Processing (\d+)\.\.\./);
                            if (foundMatch) {
                                totalToProcess = parseInt(foundMatch[1]);
                            }

                            if (message.includes('Completed') || message.includes('Skipped')) {
                                currentProgress++;
                                if (totalToProcess > 0) {
                                    const percent = Math.round((currentProgress / totalToProcess) * 100);
                                    progressBar.style.width = `${percent}%`;
                                    progressStats.textContent = `${currentProgress} of ${totalToProcess} (${percent}%)`;
                                }
                            }

                            if (message.includes('Completed') || message.includes('Done.')) {
                                p.classList.add('success');
                            } else if (message.includes('Error')) {
                                p.classList.add('error');
                            } else if (message.includes('Skipped')) {
                                p.classList.add('skip');
                            } else if (message.includes('Found') || message.includes('Processing')) {
                                p.classList.add('info');
                            }

                            if (message.includes('Done.')) {
                                progressBar.style.width = '100%';
                                progressStats.textContent = 'Complete!';
                            }

                            p.textContent = message;
                            progressLog.appendChild(p);
                            progressLog.scrollTop = progressLog.scrollHeight;
                        }
                    }
                });
            }

            loadBatchStatus();
        } catch (err) {
            if (err.name === 'AbortError') {
                const p = document.createElement('p');
                p.className = 'log-entry error';
                p.textContent = '[Batch processing stopped]';
                progressLog.appendChild(p);
                progressStats.textContent = 'Stopped';
            } else {
                const p = document.createElement('p');
                p.className = 'log-entry error';
                p.textContent = `Error: ${err.message}`;
                progressLog.appendChild(p);
                progressStats.textContent = 'Error';
            }
        } finally {
            batchRunStage2Btn.textContent = 'Run stage 2 batch extraction';
            batchStage2AbortController = null;
            loadBatchStatus();
        }
    };

    // Case Atlas functions
    async function loadAtlasCases() {
        atlasContent.innerHTML = '<p class="atlas-placeholder">Loading cases...</p>';
        try {
            const response = await fetch('/api/atlas/cases');
            if (!response.ok) {
                throw new Error('Failed to load cases');
            }
            atlasCases = await response.json();
            if (atlasCases.length === 0) {
                atlasContent.innerHTML = '<p class="atlas-placeholder">No stage 2 outputs found. Run stage 2 extraction first.</p>';
                return;
            }
            renderAtlasGrid(getActiveFilters());
        } catch (err) {
            atlasContent.innerHTML = `<p class="atlas-placeholder">Error loading cases: ${escapeHtml(err.message)}</p>`;
        }
    }

    function getFieldValue(caseData, field) {
        if (field === 'case_type') {
            return caseData.case_type || 'Unknown';
        }
        if (caseData.criminal && field in caseData.criminal) {
            return caseData.criminal[field];
        }
        if (caseData.civil && field in caseData.civil) {
            return caseData.civil[field];
        }
        return null;
    }

    function formatFieldValue(value, field) {
        if (value === null || value === undefined) {
            return 'N/A';
        }
        if (typeof value === 'boolean') {
            return value ? 'Yes' : 'No';
        }
        if (Array.isArray(value)) {
            return value.length ? value.join(', ') : 'None';
        }
        // Bucket numeric fields
        if (field === 'victim_count') {
            const n = Number(value);
            if (n === 0) return '0 victims';
            if (n === 1) return '1 victim';
            if (n <= 5) return '2-5 victims';
            return '6+ victims';
        }
        if (field === 'proximate_causation_score') {
            const n = Number(value);
            if (n <= 0.25) return 'Low (0-25%)';
            if (n <= 0.5) return 'Medium (26-50%)';
            if (n <= 0.75) return 'High (51-75%)';
            return 'Very High (76-100%)';
        }
        if (field === 'damages_claimed') {
            const n = Number(value);
            if (n < 10000) return 'Under $10K';
            if (n < 100000) return '$10K - $100K';
            if (n < 1000000) return '$100K - $1M';
            return 'Over $1M';
        }
        return String(value);
    }

    function hasValidValue(value) {
        if (value === null || value === undefined) return false;
        if (Array.isArray(value)) return value.length > 0;
        if (typeof value === 'string') return value.trim() !== '';
        return true;
    }

    function renderAtlasGrid(filters) {
        // Filter cases based on case type
        let filteredCases = atlasCases;
        
        const hasCriminalFilter = filters.some(f => CRIMINAL_FIELDS.includes(f));
        const hasCivilFilter = filters.some(f => CIVIL_FIELDS.includes(f));
        
        if (hasCriminalFilter && !hasCivilFilter) {
            filteredCases = filteredCases.filter(c => c.case_type === 'criminal');
        } else if (hasCivilFilter && !hasCriminalFilter) {
            filteredCases = filteredCases.filter(c => c.case_type === 'civil');
        } else if (hasCriminalFilter && hasCivilFilter) {
            filteredCases = [];
        }
        
        // Filter out cases that don't have valid values for ALL filter fields
        filteredCases = filteredCases.filter(caseData => {
            return filters.every(field => hasValidValue(getFieldValue(caseData, field)));
        });
        
        if (filteredCases.length === 0) {
            atlasContent.innerHTML = '<p class="atlas-placeholder">No cases match the selected grouping criteria.</p>';
            return;
        }

        // Build nested group structure
        function buildGroups(cases, filterIndex) {
            if (filterIndex >= filters.length) {
                return cases;
            }
            
            const field = filters[filterIndex];
            const groups = {};
            
            cases.forEach(caseData => {
                let value = getFieldValue(caseData, field);
                
                if (Array.isArray(value) && value.length > 0) {
                    value.forEach(v => {
                        const groupKey = formatFieldValue(v, field);
                        if (!groups[groupKey]) groups[groupKey] = [];
                        if (!groups[groupKey].includes(caseData)) {
                            groups[groupKey].push(caseData);
                        }
                    });
                } else {
                    const groupKey = formatFieldValue(value, field);
                    if (!groups[groupKey]) groups[groupKey] = [];
                    groups[groupKey].push(caseData);
                }
            });
            
            // Recursively build subgroups
            const result = {};
            Object.keys(groups).forEach(key => {
                result[key] = buildGroups(groups[key], filterIndex + 1);
            });
            return result;
        }
        
        const nestedGroups = buildGroups(filteredCases, 0);
        
        function sortKeys(keys) {
            return keys.sort((a, b) => {
                if (a === 'N/A') return 1;
                if (b === 'N/A') return -1;
                return a.localeCompare(b);
            });
        }
        
        function countCases(group) {
            if (Array.isArray(group)) return group.length;
            return Object.values(group).reduce((sum, sub) => sum + countCases(sub), 0);
        }
        
        function renderGroup(group, level, parentIdx) {
            if (Array.isArray(group)) {
                return `<div class="atlas-grid">${group.map(c => renderAtlasCard(c)).join('')}</div>`;
            }
            
            const sortedKeys = sortKeys(Object.keys(group));
            let html = '';
            
            sortedKeys.forEach((key, idx) => {
                const subgroup = group[key];
                const caseCount = countCases(subgroup);
                const animDelay = (parentIdx * 0.02) + (idx * 0.03);
                const levelClass = level === 0 ? 'atlas-group' : 'atlas-subgroup';
                const titleTag = level === 0 ? 'h3' : 'h4';
                
                html += `
                    <div class="${levelClass}" style="animation-delay: ${animDelay}s" data-level="${level}">
                        <div class="atlas-group-header">
                            <${titleTag} class="atlas-group-title">${escapeHtml(key)}</${titleTag}>
                            <span class="atlas-group-count">${caseCount} case${caseCount !== 1 ? 's' : ''}</span>
                        </div>
                        <div class="atlas-group-content">
                            ${renderGroup(subgroup, level + 1, idx)}
                        </div>
                    </div>
                `;
            });
            
            return html;
        }
        
        atlasContent.innerHTML = renderGroup(nestedGroups, 0, 0);

        // Add click handlers to cards
        atlasContent.querySelectorAll('.atlas-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('.atlas-card-close')) {
                    card.classList.remove('expanded');
                    return;
                }
                if (!card.classList.contains('expanded')) {
                    atlasContent.querySelectorAll('.atlas-card.expanded').forEach(c => c.classList.remove('expanded'));
                    card.classList.add('expanded');
                }
            });
        });
    }

    function renderAtlasCard(caseData) {
        const caseType = caseData.case_type ? caseData.case_type.toUpperCase() : 'UNKNOWN';
        const filename = caseData.filename || 'Unknown';
        
        // Build preview pills (first few key fields)
        let previewPills = [];
        if (caseData.criminal) {
            if (caseData.criminal.offense_severity) {
                previewPills.push(caseData.criminal.offense_severity);
            }
            if (caseData.criminal.charges && caseData.criminal.charges.length) {
                previewPills.push(caseData.criminal.charges[0]);
            }
        }
        if (caseData.civil) {
            if (caseData.civil.cause_of_action) {
                previewPills.push(caseData.civil.cause_of_action);
            }
            if (caseData.civil.is_settlement) {
                previewPills.push('Settlement');
            }
        }
        previewPills = previewPills.slice(0, 3);

        const previewHtml = previewPills.length
            ? previewPills.map(p => `<span class="stage2-pill">${escapeHtml(p)}</span>`).join('')
            : '<span class="stage2-muted">No details</span>';

        // Build detail view (reuse stage2 formatting)
        const detailHtml = formatStage2Output(caseData);

        return `
            <div class="atlas-card" data-filename="${escapeHtml(filename)}">
                <div class="atlas-card-header">
                    <span class="atlas-card-filename">${escapeHtml(filename.replace('.json', ''))}</span>
                    <span class="atlas-card-badge">${escapeHtml(caseType)}</span>
                    <button class="atlas-card-close" title="Close">&times;</button>
                </div>
                <div class="atlas-card-preview">${previewHtml}</div>
                <div class="atlas-card-detail">${detailHtml}</div>
            </div>
        `;
    }

});
