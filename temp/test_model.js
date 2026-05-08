const start = Date.now();
fetch('http://ollama-ollama-1:11434/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ollama' },
  body: JSON.stringify({
    model: 'glm-5.1:cloud',
    temperature: 0.3,
    max_tokens: 4096,
    messages: [
      { role: 'system', content: 'Return ONLY a JSON object with subject and html fields. No thinking, no explanation.' },
      { role: 'user', content: 'Write a short professional email introducing Test Person for a Senior Developer role. Sender: DotCloud Consulting. Return JSON with subject and html.' }
    ]
  })
}).then(r => r.json()).then(d => {
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log('Time:', elapsed + 's');
  console.log('Finish:', d.choices?.[0]?.finish_reason);
  console.log('Content len:', d.choices?.[0]?.message?.content?.length);
  console.log('Reasoning len:', d.choices?.[0]?.message?.reasoning?.length);
  const content = d.choices?.[0]?.message?.content || '';
  console.log('Content:', content.slice(0, 500) || 'EMPTY');
}).catch(e => console.error('Error:', e.message));
