import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import ExecuteToolCallRows from './ExecuteToolCallRows';

const render = (calls: Parameters<typeof ExecuteToolCallRows>[0]['calls']) =>
    renderToStaticMarkup(<ExecuteToolCallRows calls={calls} />);

test('one row per call, each naming its own tool with its arguments', () => {
    const html = render([
        { tool: 'grep', status: 'completed', input: '{"pattern":"plugin probe marker"}' },
        { tool: 'read', status: 'completed', input: '{"path":"note.txt"}' },
        { tool: 'edit', status: 'completed', input: '{"path":"note.txt"}' },
    ]);

    expect(html).toContain('data-testid="execute-tool-calls"');
    expect(html).toContain('data-tool-call="grep"');
    expect(html).toContain('data-tool-call="read"');
    expect(html).toContain('data-tool-call="edit"');
    expect(html).toContain('plugin probe marker');
    expect(html).toContain('note.txt');
    expect(html.match(/data-tool-call=/g)?.length).toBe(3);
});

test('a namespaced call shows the tool it names, not the namespace', () => {
    const html = render([{ tool: 'opencode.session_rename', status: 'completed' }]);

    expect(html).toContain('data-tool-call="session_rename"');
    expect(html).not.toContain('opencode.session_rename"');
});

test('a failed call is marked, a successful one is not', () => {
    const html = render([
        { tool: 'grep', status: 'error', input: '{"pattern":"x"}' },
        { tool: 'glob', status: 'completed', input: '{"pattern":"*"}' },
    ]);

    expect(html).toContain('data-tool-status="error"');
    expect(html).toContain('data-tool-status="completed"');
});

test('a script that called nothing renders no rows at all', () => {
    expect(render([])).toBe('');
});

test('a call without arguments still renders its row', () => {
    const html = render([{ tool: 'glob', status: 'completed' }]);

    expect(html).toContain('data-tool-call="glob"');
    expect(html.match(/data-tool-call=/g)?.length).toBe(1);
});
