import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getProjectPathDisplayName,
  indexCodexSessionsByProjectPath,
  shouldHideAutoDetectedProject,
  sortCodexProjectsForDisplay,
} from './project-path-rules.js';

const WINDOWS_HOME = 'C:\\Users\\34793';
const PYTEST_PROJECT = 'C:\\Users\\34793\\AppData\\Local\\Temp\\pytest-of-34793\\pytest-92\\test_run\\project';

test('shouldHideAutoDetectedProject hides system, home, and temp-like paths', () => {
  assert.equal(
    shouldHideAutoDetectedProject('C:\\', { homeDir: WINDOWS_HOME }),
    true,
  );
  assert.equal(
    shouldHideAutoDetectedProject('C:\\Program Files\\OriginLab\\Origin9', { homeDir: WINDOWS_HOME }),
    true,
  );
  assert.equal(
    shouldHideAutoDetectedProject(WINDOWS_HOME, { homeDir: WINDOWS_HOME }),
    true,
  );
  assert.equal(
    shouldHideAutoDetectedProject(PYTEST_PROJECT, { homeDir: WINDOWS_HOME }),
    true,
  );
});

test('shouldHideAutoDetectedProject keeps real workspaces visible and allows manual overrides', () => {
  assert.equal(
    shouldHideAutoDetectedProject('D:\\remote connection', { homeDir: WINDOWS_HOME }),
    false,
  );
  assert.equal(
    shouldHideAutoDetectedProject('D:\\skylattice', { homeDir: WINDOWS_HOME }),
    false,
  );
  assert.equal(
    shouldHideAutoDetectedProject('\\\\?\\D:\\skylattice', { homeDir: WINDOWS_HOME }),
    false,
  );
  assert.equal(
    shouldHideAutoDetectedProject(PYTEST_PROJECT, {
      homeDir: WINDOWS_HOME,
      isManuallyAdded: true,
    }),
    false,
  );
});

test('getProjectPathDisplayName returns the final path segment for Windows paths', () => {
  assert.equal(getProjectPathDisplayName('D:\\remote connection'), 'remote connection');
  assert.equal(getProjectPathDisplayName('D:\\remote connection\\repo_audit'), 'repo_audit');
  assert.equal(getProjectPathDisplayName('D:\\中文项目'), '中文项目');
  assert.equal(getProjectPathDisplayName('\\\\?\\D:\\skylattice'), 'skylattice');
});

test('indexCodexSessionsByProjectPath merges long-path variants and keeps latest session duplicates', () => {
  const sessionsByProject = indexCodexSessionsByProjectPath([
    {
      id: 'same-session',
      cwd: 'D:\\skylattice',
      lastActivity: '2026-04-09T01:00:00.000Z',
      summary: 'older variant',
    },
    {
      id: 'same-session',
      cwd: '\\\\?\\D:\\skylattice',
      lastActivity: '2026-04-09T02:00:00.000Z',
      summary: 'newer variant',
    },
    {
      id: 'other-session',
      cwd: '\\\\?\\D:\\skylattice',
      lastActivity: '2026-04-09T03:00:00.000Z',
      summary: 'another session',
    },
  ]);

  assert.equal(sessionsByProject.size, 1);

  const skylatticeSessions = [...sessionsByProject.values()][0];
  assert.equal(skylatticeSessions.length, 2);
  assert.equal(skylatticeSessions[0].id, 'other-session');
  assert.equal(skylatticeSessions[1].id, 'same-session');
  assert.equal(skylatticeSessions[1].summary, 'newer variant');
  assert.equal(skylatticeSessions[1].cwd, 'D:\\skylattice');
});

test('sortCodexProjectsForDisplay preserves only visible projects and orders by recent activity', () => {
  const sessionsByProject = indexCodexSessionsByProjectPath([
    {
      id: 'remote-1',
      cwd: 'D:\\remote connection',
      lastActivity: '2026-04-09T05:00:00.000Z',
    },
    {
      id: 'sky-1',
      cwd: '\\\\?\\D:\\skylattice',
      lastActivity: '2026-04-09T06:00:00.000Z',
    },
    {
      id: 'noise-1',
      cwd: PYTEST_PROJECT,
      lastActivity: '2026-04-09T07:00:00.000Z',
    },
  ]);

  const visibleProjects = [...sessionsByProject.values()]
    .map((sessions) => ({
      name: sessions[0].cwd,
      displayName: getProjectPathDisplayName(sessions[0].cwd),
      codexSessions: sessions,
    }))
    .filter((project) => !shouldHideAutoDetectedProject(project.codexSessions[0].cwd, { homeDir: WINDOWS_HOME }));

  const sortedProjects = sortCodexProjectsForDisplay(visibleProjects);

  assert.deepEqual(
    sortedProjects.map((project) => project.displayName),
    ['skylattice', 'remote connection'],
  );
});
