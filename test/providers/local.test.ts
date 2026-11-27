import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { LocalProvider } from '../../src/providers/local';

describe('LocalProvider', () => {
    let tmpDir: string;
    let provider: LocalProvider;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'testform-local-provider-'));
        provider = new LocalProvider(tmpDir);
    });

    afterEach(() => {
        try {
            rmSync(tmpDir, { recursive: true, force: true });
        } catch {}
    });

    it('creates an issue and writes to local database', async () => {
        const issue = await provider.createIssue({
            title: 'Verify login flow',
            body: 'Feature description',
            labels: ['testcase', 'auth']
        });

        expect(issue.id).toBe(1);
        expect(issue.number).toBe(1);
        expect(issue.title).toBe('Verify login flow');
        expect(issue.state).toBe('open');
        expect(issue.node_id).toBe('local_node_1');
        expect(issue.labels).toEqual(['testcase', 'auth']);

        // Check formatRemoteId
        expect(provider.formatRemoteId(issue.number)).toBe('local:1');
    });

    it('updates and retrieves existing issue', async () => {
        const created = await provider.createIssue({
            title: 'Cart checkout',
            body: 'Steps',
            labels: ['testcase']
        });

        const updated = await provider.updateIssue(created.number, {
            title: 'Cart checkout updated',
            state: 'closed'
        });

        expect(updated.title).toBe('Cart checkout updated');
        expect(updated.state).toBe('closed');

        const fetched = await provider.getIssue(created.number);
        expect(fetched).not.toBeNull();
        expect(fetched?.title).toBe('Cart checkout updated');
    });

    it('lists issues by label', async () => {
        await provider.createIssue({ title: 'Issue 1', body: '', labels: ['smoke', 'auth'] });
        await provider.createIssue({ title: 'Issue 2', body: '', labels: ['regression', 'cart'] });
        await provider.createIssue({ title: 'Issue 3', body: '', labels: ['smoke', 'checkout'] });

        const smokeIssues = await provider.listIssuesByLabel('smoke');
        expect(smokeIssues.length).toBe(2);
        expect(smokeIssues.map(i => i.title)).toEqual(['Issue 1', 'Issue 3']);
    });

    it('manages project item fields (custom_fields)', async () => {
        const issue = await provider.createIssue({ title: 'Payment test', body: '', labels: ['testcase'] });

        await provider.updateProjectItemFields(String(issue.number), {
            status: 'passed',
            severity: 'critical'
        });

        const fields = await provider.getProjectItemFields(issue.number);
        expect(fields.status).toBe('passed');
        expect(fields.severity).toBe('critical');
    });

    it('adds and persists sub-issue links', async () => {
        const parent = await provider.createIssue({ title: 'Plan 1', body: '', labels: ['testplan'] });
        const child = await provider.createIssue({ title: 'Run 1', body: '', labels: ['testrun'] });

        await provider.addSubIssue(parent.number, child.number);

        const fetchedParent = await provider.getIssue(parent.number);
        expect((fetchedParent as any).sub_issues).toContain(child.number);
    });

    it('dispatches CRUD via provider apis interface', async () => {
        // apis.issue.create
        const res = await provider.apis.issue.create!({
            title: 'Issue through agnostic API',
            body: 'Body content',
            labels: ['testcase']
        });
        expect(res.number).toBe(1);

        // apis.issue.get
        const got = await provider.apis.issue.get!(res.number);
        expect(got?.title).toBe('Issue through agnostic API');

        // apis.issue.update
        const updated = await provider.apis.issue.update!(res.number, {
            title: 'Title updated via API'
        });
        expect(updated.title).toBe('Title updated via API');

        // apis.project.create / update
        await provider.apis.project.create!({
            fields: { priority: 'high' }
        }, { issueResult: res });

        const customFields = await provider.getProjectItemFields(res.number);
        expect(customFields.priority).toBe('high');

        // apis.issue.delete (permanently removes issue from local database)
        await provider.apis.issue.delete!(res.number);
        const deleted = await provider.getIssue(res.number);
        expect(deleted).toBeNull();
    });

    it('permanently deletes issues, cleans sub-issue links, handles 404 idempotently, and preserves closeIssue', async () => {
        const parent = await provider.createIssue({ title: 'Parent', body: '', labels: ['testplan'] });
        const child = await provider.createIssue({ title: 'Child', body: '', labels: ['testrun'] });
        await provider.addSubIssue(parent.number, child.number);

        // closeIssue still transitions state to 'closed' without removing the record
        await provider.closeIssue(parent.number);
        expect((await provider.getIssue(parent.number))?.state).toBe('closed');

        // resources.testcase.delete removes child and prunes stale sub_issues link on parent
        await provider.resources.testcase.delete!(`local:${child.number}`);
        expect(await provider.getIssue(child.number)).toBeNull();
        expect((await provider.getIssue(parent.number) as any).sub_issues).toEqual([]);

        // Deleting an already removed issue is idempotent
        await expect(provider.deleteIssue(child.number)).resolves.toBeUndefined();
    });

    it('persists data to .testform/data.json directly', async () => {
        await provider.createIssue({
            title: 'Issue in new path',
            body: 'Verify it writes to .testform/data.json',
            labels: ['testcase']
        });

        const newPath = join(tmpDir, '.testform', 'data.json');
        expect(existsSync(newPath)).toBe(true);
        const data = JSON.parse(readFileSync(newPath, 'utf8'));
        expect(data.issues).toHaveLength(1);
        expect(data.issues[0].title).toBe('Issue in new path');
    });

    it('automatically migrates data from legacy .testform/cache/data.json', async () => {
        const legacyDir = join(tmpDir, '.testform', 'cache');
        mkdirSync(legacyDir, { recursive: true });
        const legacyFile = join(legacyDir, 'data.json');
        const legacyData = {
            issues: [
                {
                    id: 99,
                    number: 99,
                    title: 'Legacy issue from cache',
                    body: 'Migrated content',
                    state: 'open',
                    node_id: 'local_node_99',
                    labels: ['testcase'],
                    comments: [],
                    custom_fields: {}
                }
            ],
            next_issue_number: 100,
            next_comment_id: 1
        };
        writeFileSync(legacyFile, JSON.stringify(legacyData, null, 2), 'utf8');

        // Create a new provider instance pointing to tmpDir where .testform/data.json does not exist yet
        const freshProvider = new LocalProvider(tmpDir);
        const issue = await freshProvider.getIssue(99);
        expect(issue).not.toBeNull();
        expect(issue?.title).toBe('Legacy issue from cache');

        // Check that .testform/data.json was created via automatic migration
        const newPath = join(tmpDir, '.testform', 'data.json');
        expect(existsSync(newPath)).toBe(true);
        const migratedContent = JSON.parse(readFileSync(newPath, 'utf8'));
        expect(migratedContent.next_issue_number).toBe(100);
        expect(migratedContent.issues[0].title).toBe('Legacy issue from cache');
    });

    it('supports git-native schema configuration (e.g. gitlab, github)', async () => {
        const gitlabProvider = new LocalProvider(tmpDir, 'gitlab');
        expect(gitlabProvider.schema).toBe('gitlab');

        await gitlabProvider.createIssue({
            title: 'GitLab formatted issue',
            body: '```gherkin\nGiven something\n```',
            labels: ['severity::major', 'type::bug']
        });

        const dbPath = join(tmpDir, '.testform', 'data.json');
        const dbContent = JSON.parse(readFileSync(dbPath, 'utf8'));
        expect(dbContent.schema).toBe('gitlab');
        expect(dbContent.issues[0].title).toBe('GitLab formatted issue');
        expect(dbContent.issues[0].labels).toContain('severity::major');
    });
});

