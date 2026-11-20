import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const fixture = await readFile(new URL('quiz.html', import.meta.url));
const figure = await readFile(new URL('triangle.svg', import.meta.url));
const sequence = await readFile(new URL('sequence.html', import.meta.url));

export function createDemoServer() {
  return createServer(async (request, response) => {
    if (request.method === 'GET' && request.url.startsWith('/sequence')) {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(sequence);
      return;
    }
    if (request.method === 'GET' && request.url === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(fixture);
      return;
    }
    if (request.method === 'GET' && request.url === '/triangle.svg') {
      response.writeHead(200, { 'Content-Type': 'image/svg+xml' }).end(figure);
      return;
    }
    if (request.method === 'POST' && ['/v1/chat/completions', '/v1/responses'].includes(request.url)) {
      try {
        let body = '';
        for await (const chunk of request) {
          body += chunk;
          if (body.length > 3200000) {
            response.writeHead(413).end();
            return;
          }
        }
        const payload = JSON.parse(body);
        const responses = request.url === '/v1/responses';
        const input = (responses ? payload.input : payload.messages).at(-1).content;
        const { html, targets, phase, previousHtml = '' } = JSON.parse(typeof input === 'string' ? input : input[0].text);
        if (phase === 'verify') {
          const heading = html.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1]?.replace(/<[^>]*>/g, '').trim() || '';
          const pageChanged = Boolean(heading && !previousHtml.includes(heading));
          const content = JSON.stringify({ answers: [], pageChanged, evidence: pageChanged ? heading : '', message: pageChanged ? '已展示新的题目。' : '当前仍是同一道题。' });
          response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(responses
            ? { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: content }] }] }
            : { choices: [{ message: { content } }] }));
          return;
        }
        if (phase === 'navigate') {
          const next = targets.find((target) => target.kind === 'navigation');
          const content = JSON.stringify({ answers: [], next: next ? { target: next.id, reason: '演示页还有下一题。' } : null, message: next ? '' : '没有下一题，答题结束。' });
          response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(responses
            ? { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: content }] }] }
            : { choices: [{ message: { content } }] }));
          return;
        }
        const usesImage = Array.isArray(input) && input.some((part) => ['input_image', 'image_url'].includes(part.type));
        const examples = [
          { question: '2 + 3 等于多少？', marker: '2 + 3', values: [['5', true]] },
          { question: '以下哪些数是质数？', marker: '质数', values: [['2', true], ['7', true], ['4', false]] },
          { question: '水的化学式是什么？', marker: '水的化学式', values: [['H₂O', true]] },
          { question: '图中的绿色图形是什么？', marker: '绿色图形', values: usesImage ? [['三角形', true]] : [] },
          { question: '6 + 2 等于多少？', marker: '6 + 2', values: [['B. 8', null]] },
        ];
        const answers = examples.flatMap(({ question, marker, values }) => {
          if (!html.includes(marker)) return [];
          const actions = values.flatMap(([text, selected]) => {
            const target = targets.find((item) => item.text === text && ['label', 'button', 'div', 'span'].includes(item.tag) &&
              (selected !== false || item.selected === true));
            return target ? [{ target: target.id, selected }] : [];
          });
          return actions.length ? [{ question, actions, reason: '这是演示服务根据 HTML 元素编号返回的预设答案。' }] : [];
        });
        const inputs = targets.filter((target) => target.kind === 'input');
        if (inputs.length && (html.includes('请分别填写数字') || html.includes('最后一题'))) {
          const values = html.includes('最后一题') ? ['done'] : ['42', 'hello world', '测试成功'];
          answers.push({ question: html.includes('最后一题') ? '最后一题：输入 done' : '填写数字、短句和词语',
            actions: inputs.map((target, index) => ({ target: target.id, type: 'fill', value: values[index] })),
            reason: '演示页面指定的输入内容。' });
        }
        response.writeHead(200, { 'Content-Type': 'application/json' });
        const content = JSON.stringify({ answers });
        response.end(JSON.stringify(responses
          ? { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: content }] }] }
          : { choices: [{ message: { content } }] }));
      } catch {
        response.writeHead(400).end();
      }
      return;
    }
    response.writeHead(404).end();
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createDemoServer().listen(8787, '127.0.0.1', () => console.log('练习页：http://127.0.0.1:8787'));
}
