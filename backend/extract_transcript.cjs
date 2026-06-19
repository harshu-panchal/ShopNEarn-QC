const fs = require('fs');

const transcriptPath = 'C:\\Users\\harsh\\.gemini\\antigravity\\brain\\96c916f9-ecdf-409e-951d-8123c76e3edc\\.system_generated\\logs\\transcript.jsonl';
const content = fs.readFileSync(transcriptPath, 'utf8');

const lines = content.split('\n');
for (const line of lines) {
    if (line.includes('export const getMyLegTeam')) {
        console.log(line.substring(0, 500));
        fs.appendFileSync('extracted_code.txt', line + '\n');
    }
}
console.log('Done');
