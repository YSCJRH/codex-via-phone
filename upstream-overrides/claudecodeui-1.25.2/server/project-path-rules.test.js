import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getProjectPathDisplayName,
  indexCodexSessionsByProjectPath,
  shouldHideAutoDetectedProject,
  sortCodexProjectsForDisplay,
} from './project-path-rules.js';

const WINDOWS_HOME = 'C:\\Users\\example-user';
const PYTEST_PROJECT = 'C:\\Users\\example-user\\AppData\\Local\\Temp\\pytest-of-example-user\\pytest-92\\test_run\\project';
const PRIMARY_WORKSPACE = 'D:\\workspaces\\mobile helper';
const SECONDARY_WORKSPACE = 'D:\\workspaces\\sample project';
const SECONDARY_WORKSPACE_LONG = '\\\\?\\D:\\workspaces\\sample project';

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
    shouldHideAutoDetectedProject(PRIMARY_WORKSPACE, { homeDir: WINDOWS_HOME }),
    false,
  );
  assert.equal(
    shouldHideAutoDetectedProject(SECONDARY_WORKSPACE, { homeDir: WINDOWS_HOME }),
    false,
  );
  assert.equal(
    shouldHideAutoDetectedProject(SECONDARY_WORKSPACE_LONG, { homeDir: WINDOWS_HOME }),
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
  assert.equal(getProjectPathDisplayName(PRIMARY_WORKSPACE), 'mobile helper');
  assert.equal(getProjectPathDisplayName('D:\\workspaces\\mobile helper\\nested project'), 'nested project');
  assert.equal(getProjectPathDisplayName('D:\\中文项目'), '中文项目');
  assert.equal(getProjectPathDisplayName(SECONDARY_WORKSPACE_LONG), 'sample project');
});

test('indexCodexSessionsByProjectPath merges long-path variants and keeps latest session duplicates', () => {
  const sessionsByProject = indexCodexSessionsByProjectPath([
    {
      id: 'same-session',
      cwd: SECONDARY_WORKSPACE,
      lastActivity: '2026-04-09T01:00:00.000Z',
      summary: 'older variant',
    },
    {
      id: 'same-session',
      cwd: SECONDARY_WORKSPACE_LONG,
      lastActivity: '2026-04-09T02:00:00.000Z',
      summary: 'newer variant',
    },
    {
      id: 'other-session',
      cwd: SECONDARY_WORKSPACE_LONG,
      lastActivity: '2026-04-09T03:00:00.000Z',
      summary: 'another session',
    },
  ]);

  assert.equal(sessionsByProject.size, 1);

  const sampleProjectSessions = [...sessionsByProject.values()][0];
  assert.equal(sampleProjectSessions.length, 2);
  assert.equal(sampleProjectSessions[0].id, 'other-session');
  assert.equal(sampleProjectSessions[1].id, 'same-session');
  assert.equal(sampleProjectSessions[1].summary, 'newer variant');
  assert.equal(sampleProjectSessions[1].cwd, SECONDARY_WORKSPACE);
});

test('sortCodexProjectsForDisplay preserves only visible projects and orders by recent activity', () => {
  const sessionsByProject = indexCodexSessionsByProjectPath([
    {
      id: 'remote-1',
      cwd: PRIMARY_WORKSPACE,
      lastActivity: '2026-04-09T05:00:00.000Z',
    },
    {
      id: 'sky-1',
      cwd: SECONDARY_WORKSPACE_LONG,
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
    ['sample project', 'mobile helper'],
  );
});
