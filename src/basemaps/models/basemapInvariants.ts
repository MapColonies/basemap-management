interface ILayerUniquenessProperties {
  id: string;
  order: number;
}

function groupDuplicates<K>(keys: readonly K[]): Map<K, number[]> {
  const positions = new Map<K, number[]>();
  keys.forEach((key, index) => {
    positions.set(key, [...(positions.get(key) ?? []), index]);
  });
  return new Map([...positions].filter(([, indexes]) => indexes.length > 1));
}

const quoteAll = (values: readonly string[]): string => values.map((value) => `"${value}"`).join(', ');

function findLayerConflicts(layers: readonly ILayerUniquenessProperties[]): string[] {
  const conflicts: string[] = [];
  for (const [id, indexes] of groupDuplicates(layers.map((layer) => layer.id))) {
    conflicts.push(`duplicate layer id "${id}" (layers at positions ${indexes.join(', ')})`);
  }
  for (const [order, indexes] of groupDuplicates(layers.map((layer) => layer.order))) {
    conflicts.push(`duplicate layer order ${order} (layers ${quoteAll(indexes.map((index) => layers[index]!.id))})`);
  }
  return conflicts;
}

function describeEntry(entry: unknown, index: number): string {
  const id = (entry as { id?: unknown } | null)?.id;
  return typeof id === 'string' ? `"${id}"` : `<entry at index ${index} without an id>`;
}

function findCollectionConflicts(entries: readonly unknown[]): string[] {
  const conflicts: string[] = [];

  const ids = entries.map((entry) => (entry as { id?: unknown } | null)?.id).filter((id): id is string => typeof id === 'string');
  for (const [id, indexes] of groupDuplicates(ids)) {
    conflicts.push(`duplicate basemap id "${id}" (${indexes.length} entries)`);
  }

  for (const flag of ['isCurrent', 'isForPreview'] as const) {
    const owners = entries.flatMap((entry, index) =>
      (entry as Record<string, unknown> | null)?.[flag] === true ? [describeEntry(entry, index)] : []
    );
    if (owners.length > 1) {
      conflicts.push(`multiple basemaps have ${flag}=true: ${owners.join(', ')}`);
    }
  }

  return conflicts;
}

export { findLayerConflicts, findCollectionConflicts };
