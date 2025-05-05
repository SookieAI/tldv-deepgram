// server.js
const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { tmpdir } = require('os');
const { v4: uuidv4 } = require('uuid');
const app = express();

app.use(express.json({ limit: '10mb' }));

app.post('/transcribe', async (req, res) => {
  const { m3u8Url, deepgramKey, model } = req.body;
  if (!m3u8Url || !deepgramKey || !model) return res.status(400).send({ error: 'Missing parameters' });

  const id = uuidv4();
  const tmp = path.join(tmpdir(), id);
  fs.mkdirSync(tmp);

  try {
    const listText = await fetch(m3u8Url).then(r => r.text());
    const base = m3u8Url.slice(0, m3u8Url.lastIndexOf('/') + 1);
    const segments = listText.split('\n').filter(l => l && !l.startsWith('#') && l.endsWith('.ts'));
    const segmentFiles = [];

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const filePath = path.join(tmp, `seg${i}.ts`);
      const buffer = await fetch(base + seg).then(r => r.arrayBuffer());
      fs.writeFileSync(filePath, Buffer.from(buffer));
      segmentFiles.push(`file 'seg${i}.ts'`);
    }

    const listPath = path.join(tmp, 'list.txt');
    fs.writeFileSync(listPath, segmentFiles.join('\n'));

    const output = path.join(tmp, 'output.wav');
    await new Promise((resolve, reject) => {
      exec(`ffmpeg -y -f concat -safe 0 -i ${listPath} -vn -acodec pcm_s16le -ar 16000 -ac 1 ${output}`,
        { cwd: tmp },
        (err, stdout, stderr) => (err ? reject(err) : resolve()));
    });

    const wavBuffer = fs.readFileSync(output);
    const dgRes = await fetch(`https://api.deepgram.com/v1/listen?model=${encodeURIComponent(model)}&punctuate=true&paragraphs=true`, {
      method: 'POST',
      headers: {
        Authorization: 'Token ' + deepgramKey,
        'Content-Type': 'audio/wav'
      },
      body: wavBuffer
    });
    const dgJson = await dgRes.json();
    res.send({ transcript: dgJson });
  } catch (e) {
    res.status(500).send({ error: e.message });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

app.listen(3000, () => console.log('Server running on port 3000'));
