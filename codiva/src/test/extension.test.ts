import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Codiva Extension', () => {
	test('tracks manual lines and XP', async () => {
		// Ensure extension is activated
	const ext = vscode.extensions.getExtension('codiva-team.codiva');
		assert.ok(ext, 'Extension should be present');
	await ext!.activate();
	// small delay to ensure activation side-effects are ready
	await new Promise(r => setTimeout(r, 10));

		// Reset stats before test
		await vscode.commands.executeCommand('codiva.resetStats');

		// Create a new untitled document and insert some text in document
		const doc = await vscode.workspace.openTextDocument({ language: 'plaintext', content: '' });
		const editor = await vscode.window.showTextDocument(doc);

		await editor.edit(editBuilder => {
			editBuilder.insert(new vscode.Position(0, 0), 'line1\nline2\nline3\n');
		});

		// Allow VS Code event loop to process change events in Codiva
		await new Promise(r => setTimeout(r, 50));

		const stats = (await vscode.commands.executeCommand('codiva.getStats')) as any;
		assert.ok(stats, 'Should return stats');
		assert.strictEqual(stats.manualLines >= 3, true, 'Manual lines should be at least 3');
		assert.ok(stats.xp >= 30, `XP should be at least 30 for 3 new lines, got ${stats.xp}`);
		assert.strictEqual(stats.level, 1, 'Still level 1 for small XP');
		assert.ok(Array.isArray(stats.achievements), 'Achievements should be array');
	});
});
