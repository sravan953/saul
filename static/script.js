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
    const runStage2Btn = document.getElementById('run-stage2-btn');
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
    let stage2AbortController = null;
    let batchStage2AbortController = null;
    let statusAbortController = null;

    runStage2Btn.hidden = true;
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

        const addSection = (title, obj) => {
            if (!obj) {
                return;
            }
            const rows = Object.entries(obj).map(([key, value]) => {
                const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                return `<div class="stage2-row"><dt>${escapeHtml(label)}</dt><dd>${formatStage2Value(value)}</dd></div>`;
            });
            sections.push(
                `<div class="stage2-section"><div class="stage2-section-title">${escapeHtml(title)}</div><dl class="stage2-list">${rows.join('')}</dl></div>`
            );
        };

        addSection('Criminal', data.criminal);
        addSection('Civil', data.civil);

        return `<div class="stage2-output"><div class="stage2-header"><span class="stage2-label">Case Type</span><span class="stage2-badge">${escapeHtml(caseType)}</span></div>${sections.join('')}</div>`;
    }

    function setActiveTab(stage) {
        const isStage2 = stage === 'stage2';
        tabStage1.classList.toggle('active', !isStage2);
        tabStage2.classList.toggle('active', isStage2);
        stage1Output.classList.toggle('active', !isStage2);
        stage2Output.classList.toggle('active', isStage2);
    }

    tabStage1.addEventListener('click', () => setActiveTab('stage1'));
    tabStage2.addEventListener('click', () => setActiveTab('stage2'));

    // Sidebar toggle
    sidebarToggle.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
    });

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
        runBtn.disabled = true;
        runBtn.textContent = 'Run stage 1 case extraction';
        runStage2Btn.disabled = true;
        runStage2Btn.hidden = true;
        runStage2Btn.textContent = 'Run stage 2 case extraction';
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
            runBtn.textContent = 'Run stage 1 case extraction';
        }
        if (stage2AbortController) {
            stage2AbortController.abort();
            stage2AbortController = null;
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
                const hasStage1 = stage1Status.exists === true;
                const hasStage2 = stage2Status.exists === true;

                tabStage1.disabled = !hasStage1;
                tabStage2.disabled = !hasStage2;

                if (hasStage1) {
                    runBtn.disabled = true;
                    runStage2Btn.hidden = false;
                    runStage2Btn.disabled = hasStage2;
                } else {
                    runBtn.disabled = false;
                    runBtn.textContent = 'Run stage 1 case extraction';
                }

                const stage1Fetch = hasStage1
                    ? fetch(`/api/output/${filename}`, { signal }).then(response => {
                          if (response.ok) {
                              return response.text();
                          }
                          return null;
                      })
                    : Promise.resolve(null);

                const stage2Fetch = hasStage2
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
                    return { html, stage2, hasStage1, hasStage2 };
                });
            })
            .then(result => {
                if (!result) {
                    return;
                }

                const { html, stage2, hasStage1, hasStage2 } = result;
                if (html) {
                    stage1Output.innerHTML = html;
                }
                if (stage2) {
                    stage2Output.innerHTML = formatStage2Output(stage2);
                }

                if (hasStage2) {
                    setActiveTab('stage2');
                } else if (hasStage1) {
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
                runBtn.disabled = false;
                runBtn.textContent = 'Run stage 1 case extraction';
            });
    }

    runBtn.onclick = async () => {
        if (!selectedFile) return;

        if (abortController) {
            abortController.abort();
            abortController = null;
            runBtn.textContent = 'Run stage 1 case extraction';
            return;
        }

        stage1Output.innerHTML = '<p>Thinking...</p>';
        runBtn.textContent = 'Stop';
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
                runBtn.disabled = true;
                runBtn.textContent = 'Run stage 1 case extraction';
                runStage2Btn.hidden = false;
                runStage2Btn.disabled = false;
                tabStage1.disabled = false;
                setActiveTab('stage1');
            } else {
                runBtn.textContent = 'Run stage 1 case extraction';
                runStage2Btn.hidden = true;
                runStage2Btn.disabled = true;
            }
            abortController = null;
        }
    };

    runStage2Btn.onclick = async () => {
        if (!selectedFile) return;

        if (stage2AbortController) {
            stage2AbortController.abort();
            stage2AbortController = null;
            runStage2Btn.textContent = 'Run stage 2 case extraction';
            return;
        }

        stage2Output.innerHTML = '<p class="stage2-muted">Thinking...</p>';
        runStage2Btn.textContent = 'Stop';
        stage2AbortController = new AbortController();

        try {
            const response = await fetch(`/api/analyze_stage2/${selectedFile}`, {
                method: 'POST',
                signal: stage2AbortController.signal
            });

            if (!response.ok) {
                const detail = await response.text();
                throw new Error(detail || `Request failed (${response.status})`);
            }

            const data = await response.json();
            stage2Output.innerHTML = formatStage2Output(data);
            const outputContainer = document.getElementById('analysis-output');
            outputContainer.scrollTop = outputContainer.scrollHeight;
            tabStage2.disabled = false;
            setActiveTab('stage2');
            runStage2Btn.disabled = true;
        } catch (err) {
            if (err.name === 'AbortError') {
                stage2Output.innerHTML += '<p class="stage2-muted">[Stage 2 stopped]</p>';
            } else {
                stage2Output.innerHTML = `<p class="stage2-error">Error: ${escapeHtml(err.message)}</p>`;
            }
        } finally {
            runStage2Btn.textContent = 'Run stage 2 case extraction';
            stage2AbortController = null;
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
});
