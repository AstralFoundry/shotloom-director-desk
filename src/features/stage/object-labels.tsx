import { session } from '@/state/editor-session.ts';
import { useStageOverlayStore } from '@/state/stage-overlay-store.ts';

/** Object name tags projected from the 3D scene; clicking one selects the entity. */
export function ObjectLabels({
    onContextMenu,
}: {
    onContextMenu?: (id: string, event: React.MouseEvent<HTMLElement>) => void;
}) {
    const labels = useStageOverlayStore((state) => state.labels);
    const selected = useStageOverlayStore((state) => state.selected);

    return (
        <div className="object-labels">
            {labels
                .filter((label) => label.visible)
                .map((label) => (
                    <button
                        type="button"
                        key={label.id}
                        className={`object-label ${label.id === selected ? 'is-selected' : ''}`}
                        style={{ left: label.x, top: label.y }}
                        onClick={() => session.selectEntity(label.id)}
                        onContextMenu={(event) => onContextMenu?.(label.id, event)}
                    >
                        <i style={{ background: label.color }} />
                        <span>{label.name}</span>
                    </button>
                ))}
        </div>
    );
}
