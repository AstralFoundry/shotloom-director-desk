export async function setupDemoScene(page) {
    await page.evaluate(async () => {
        const { entity, clip } = await import('/src/core/model.ts');
        const { createStarterProject } = await import('/src/state/starter-project.ts');
        const { readSceneDocument } = await import('/src/core/scenes/sequence-project.ts');
        const { editorPreferences } = await import('/src/core/editor/preferences.ts');
        const { session, store } = window.__editorDebug;
        const project = createStarterProject();
        project.name = '午后会面';
        project.duration = 12;
        const actor = project.entities.find((e) => e.kind === 'actor');
        actor.name = '角色 A';
        actor.position = [-1.7, 0, 0.6];
        actor.color = '#467b9b';
        actor.clips = [clip('walk', 0, 4), clip('wave', 4, 7), clip('idle', 7, 12)];
        actor.path = {
            smooth: true,
            points: [
                { time: 0, position: [-1.7, 0, 0.6] },
                { time: 2, position: [-0.8, 0, 0.1] },
                { time: 4, position: [0, 0, -0.2] },
            ],
        };
        const other = entity('actor', 'person', '角色 B', [1.35, 0, -0.8]);
        other.color = '#b17451';
        other.rotation[1] = -0.9;
        other.clips = [clip('idle', 0, 4), clip('wave', 4, 7), clip('idle', 7, 12)];
        const table = entity('prop', 'table', '会面桌', [0.7, 0, -1.8]);
        table.color = '#b1a38d';
        const chair = entity('prop', 'chair', '座椅', [0.7, 0, -2.6]);
        chair.rotation[1] = Math.PI;
        project.entities.push(other, table, chair);
        const camera = project.entities.find((e) => e.kind === 'camera');
        camera.position = [4.5, 2.3, 6];
        camera.camera.target = [0, 0.95, -0.3];
        camera.camera.focal = 40;
        session.replaceSceneDocument(readSceneDocument(project), 'README demonstration');
        session.selectEntity(camera.id);
        session.setPreview(camera.id);
        session.applyCameraPreset('dolly-in', camera.id, { subjectId: actor.id });
        session.setView('pip');
        session.setInspectorTab('camera');
        session.seek(1.5);
        store.setState({ sidebarTab: 'scene' });
        editorPreferences.set('timelineVisible', true);
        editorPreferences.set('timelineHeight', 310);
        editorPreferences.set('labelMode', 'off');
        const engine = session.engineOrNull;
        engine.editorCamera.position.set(-5.3, 4, 6.5);
        engine.orbit.target.set(0, 0.7, -0.4);
        engine.orbit.update();
    });
}
