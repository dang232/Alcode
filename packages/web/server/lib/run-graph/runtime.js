import { promises as fsPromises } from 'node:fs';
import path from 'node:path';

const RUNS_DIRNAME = 'dag-runs';
const SNAPSHOT_SUFFIX = '.snapshot.json';

const asText = (value) => `${value ?? ''}`.trim();

const isSafeConversationId = (value) => {
  const text = asText(value);
  return text.length > 0 && !/[\\/]/.test(text) && !text.includes('..');
};

export const createRunGraphRuntime = (overrides = {}) => {
  const fs = overrides.fs ?? fsPromises;
  const joinPath = overrides.joinPath ?? path.join;
  const normalizePath = overrides.normalizePath ?? path.normalize;

  const normalizeDirectory = async (directory) => {
    const trimmed = asText(directory);
    if (!trimmed) {
      return { error: 'directory is required' };
    }
    const normalized = normalizePath(trimmed);
    let stat = null;
    try {
      stat = await fs.stat(normalized);
    } catch {
      return { error: `directory not found: ${trimmed}`, status: 404 };
    }
    if (!stat.isDirectory()) {
      return { error: `not a directory: ${trimmed}`, status: 404 };
    }
    return { directory: normalized };
  };

  const readSnapshot = async (directory, conversationId) => {
    const id = asText(conversationId);
    if (!isSafeConversationId(id)) {
      return { error: 'conversationId is required', status: 400 };
    }
    const filePath = joinPath(directory, '.omo', RUNS_DIRNAME, `${id}${SNAPSHOT_SUFFIX}`);
    const normalized = normalizePath(filePath);
    const root = normalizePath(joinPath(directory, '.omo', RUNS_DIRNAME));
    if (normalized !== joinPath(root, `${id}${SNAPSHOT_SUFFIX}`)) {
      return { error: 'conversationId is required', status: 400 };
    }
    let raw = null;
    try {
      raw = await fs.readFile(normalized, 'utf8');
    } catch {
      return { error: `no run snapshot for conversation: ${id}`, status: 404 };
    }
    try {
      return JSON.parse(raw);
    } catch {
      const error = new Error(`run snapshot is malformed: ${id}`);
      error.status = 500;
      throw error;
    }
  };

  return { normalizeDirectory, readSnapshot };
};
