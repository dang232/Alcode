// Regression test for the PowerShell shell-dialect guard in the bundled
// /ulw workflow instruction. Asserts the instruction keeps the shell dialect
// matched to the invocation form (PowerShell vs sh/Bash) and stays scoped.
import { describe, expect, test } from 'bun:test';

import { ulwWorkflowInstruction } from './ulwWorkflow';

describe('ulwWorkflowInstruction dialect guard', () => {
  test('instruction carries the PowerShell dialect guard and session scoping', () => {
    const instruction = ulwWorkflowInstruction('dummy-session');
    expect(instruction).toContain('Get-ChildItem');
    expect(instruction).toContain('Select-Object');
    expect(instruction).toContain('PowerShell');
    expect(instruction).toContain('"$ULW_LOOP_CLI"');
    expect(instruction).toContain('& $ULW_LOOP_CLI');
    expect(instruction).toContain('--session-id "dummy-session"');
  });
});
