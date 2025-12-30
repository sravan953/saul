document.addEventListener('DOMContentLoaded', () => {
    const fileList = document.getElementById('file-list');
    const caseFrame = document.getElementById('case-frame');
    const runBtn = document.getElementById('run-btn');
    const outputText = document.getElementById('output-text');
    
    let selectedFile = null;
    let abortController = null;

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
        runBtn.disabled = false;
        
        // Load HTML content
        // We use the API endpoint to serve the HTML file
        caseFrame.src = `/api/html/${filename}`;
        
        // Clear previous analysis
        outputText.innerHTML = '';
        if (abortController) {
            abortController.abort();
            abortController = null;
            runBtn.textContent = 'Run Saul';
        }
    }

    runBtn.onclick = async () => {
        if (!selectedFile) return;

        // If currently running, stop it (toggle behavior optional, but good for UX)
        if (abortController) {
            abortController.abort();
            abortController = null;
            runBtn.textContent = 'Run Saul';
            return;
        }

        outputText.innerHTML = '<p>Thinking...</p>';
        runBtn.textContent = 'Stop';
        abortController = new AbortController();

        try {
            const response = await fetch(`/api/analyze/${selectedFile}`, {
                method: 'POST',
                signal: abortController.signal
            });

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
            // Auto-scroll to bottom
            const outputContainer = document.getElementById('analysis-output');
            outputContainer.scrollTop = outputContainer.scrollHeight;
        } catch (err) {
            if (err.name === 'AbortError') {
                outputText.innerHTML += '<p>[Analysis stopped]</p>';
            } else {
                outputText.innerHTML = `<p>Error: ${err.message}</p>`;
            }
        } finally {
            runBtn.textContent = 'Run Saul';
            abortController = null;
        }
    };
});

