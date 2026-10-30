import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
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

        // apis.issue.delete (closes issue)
        await provider.apis.issue.delete!(res.number);
        const closed = await provider.getIssue(res.number);
        expect(closed?.state).toBe('closed');
    });
});

