const fs = require('fs');
const transcriptPath = 'C:\\Users\\harsh\\.gemini\\antigravity\\brain\\96c916f9-ecdf-409e-951d-8123c76e3edc\\.system_generated\\logs\\transcript_full.jsonl';
const content = fs.readFileSync(transcriptPath, 'utf8');

const lines = content.split('\n');
for (const line of lines) {
    if (!line) continue;
    try {
        const obj = JSON.parse(line);
        if (obj.step_index === 1064) {
            fs.writeFileSync('step_1064.txt', obj.content || JSON.stringify(obj, null, 2));
            console.log('Successfully saved step 1064 content');
        }
    } catch (e) {}
}
