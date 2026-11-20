/** 只接受本列表内发起的拖动；外部文本、文件及全局设置条目不能参与排序。 */
export function createRuleDrag(list, onMove, onStart = () => {}, canMove = () => true) {
  let sourceId = null;
  const clearTargets = () => {
    for (const item of list.querySelectorAll('.group-item')) {
      item.classList.remove('drop-before', 'drop-after');
    }
  };
  const clear = () => {
    clearTargets();
    for (const item of list.querySelectorAll('.group-item')) item.classList.remove('dragging');
    sourceId = null;
  };
  list.addEventListener('dragleave', event => {
    if (!list.contains(event.relatedTarget)) clearTargets();
  });
  return function bind(row, item, id) {
    row.draggable = true;
    row.addEventListener('pointerdown', event => {
      row.draggable = !event.target.closest('button');
    });
    row.addEventListener('dragstart', event => {
      if (!row.draggable || !canMove()) { event.preventDefault(); return; }
      clear();
      sourceId = id;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', id);
      onStart();
      item.classList.add('dragging');
    });
    item.addEventListener('dragover', event => {
      if (!sourceId || sourceId === id || !canMove()) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      clearTargets();
      const bounds = row.getBoundingClientRect();
      item.classList.add(event.clientY < bounds.top + bounds.height / 2 ? 'drop-before' : 'drop-after');
    });
    item.addEventListener('drop', event => {
      if (!sourceId) return;
      event.preventDefault();
      event.stopPropagation();
      const source = sourceId;
      const bounds = row.getBoundingClientRect();
      const after = event.clientY >= bounds.top + bounds.height / 2;
      clear();
      if (source !== id && canMove()) onMove(source, id, after);
    });
    row.addEventListener('dragend', clear);
  };
}
