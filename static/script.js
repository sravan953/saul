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
    const outputText = document.getElementById('output-text');
    
    // Case extraction elements
    const totalCasesEl = document.getElementById('total-cases');
    const processedCasesEl = document.getElementById('processed-cases');
    const limitInput = document.getElementById('limit-input');
    const batchRunBtn = document.getElementById('batch-run-btn');
    const progressLog = document.getElementById('progress-log');
    const progressBarContainer = document.getElementById('progress-bar-container');
    const progressBar = document.getElementById('progress-bar');
    const progressStats = document.getElementById('progress-stats');

    let selectedFile = null;
    let abortController = null;
    let batchAbortController = null;

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
        })
        .catch(err => console.error('Error fetching files:', err));

    function selectFile(filename, element) {
        // Update UI selection
        document.querySelectorAll('.file-item').forEach(el => el.classList.remove('selected'));
        element.classList.add('selected');
        
        selectedFile = filename;
        runBtn.disabled = true;
        runBtn.textContent = 'Run Saul';
        
        // Load HTML content
        caseFrame.src = `/api/html/${filename}`;
        
        // Clear previous analysis
        outputText.innerHTML = '';
        if (abortController) {
            abortController.abort();
            abortController = null;
            runBtn.textContent = 'Run Saul';
        }

        // Check if output JSON exists before enabling run
        fetch(`/api/output/exists/${filename}`)
            .then(response => {
                if (response.ok) {
                    return response.json();
                }
                return { exists: false };
            })
            .then(data => {
                if (data.exists) {
                    runBtn.disabled = true;
                    runBtn.textContent = 'Already processed';
                    return fetch(`/api/output/${filename}`)
                        .then(response => {
                            if (response.ok) {
                                return response.text();
                            }
                            return null;
                        });
                }

                runBtn.disabled = false;
                runBtn.textContent = 'Run Saul';
                return null;
            })
            .then(html => {
                if (html) {
                    outputText.innerHTML = html;
                    const outputContainer = document.getElementById('analysis-output');
                    outputContainer.scrollTop = outputContainer.scrollHeight;
                }
            })
            .catch(err => {
                console.log('Cache check failed:', err);
                runBtn.disabled = false;
                runBtn.textContent = 'Run Saul';
            });
    }

    runBtn.onclick = async () => {
        if (!selectedFile) return;

        if (abortController) {
            abortController.abort();
            abortController = null;
            runBtn.textContent = 'Run Saul';
            return;
        }

        outputText.innerHTML = '<p>Thinking...</p>';
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
            
            outputText.innerHTML = html;
            const outputContainer = document.getElementById('analysis-output');
            outputContainer.scrollTop = outputContainer.scrollHeight;
            analysisSucceeded = true;
        } catch (err) {
            if (err.name === 'AbortError') {
                outputText.innerHTML += '<p>[Analysis stopped]</p>';
            } else {
                outputText.innerHTML = `<p>Error: ${err.message}</p>`;
            }
        } finally {
            if (analysisSucceeded) {
                runBtn.disabled = true;
                runBtn.textContent = 'Already processed';
            } else {
                runBtn.textContent = 'Run Saul';
            }
            abortController = null;
        }
    };

    // Batch processing functions
    async function loadBatchStatus() {
        try {
            const response = await fetch('/api/batch/status');
            const data = await response.json();
            totalCasesEl.textContent = data.total;
            processedCasesEl.textContent = data.processed;
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
            batchRunBtn.textContent = 'Run Saul in batch mode';
            return;
        }

        progressLog.innerHTML = '';
        progressBar.style.width = '0%';
        progressStats.textContent = 'Starting...';
        batchRunBtn.textContent = 'Stop';
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
            batchRunBtn.textContent = 'Run Saul in batch mode';
            batchAbortController = null;
        }
    };
});
