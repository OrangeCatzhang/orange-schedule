(() => {
  'use strict';
  const api = window.weeklight;
  const i18n = window.WeeklightI18n, tr = (key, values) => i18n.t(key, values);
  const verbs = { complete: '完成', reopen: '恢复为待办', delete: '删除' };
  let active = false;
  const errorText = error => String(error?.message || error).replace(/^Error invoking remote method '[^']+': Error: /, '');

  function ask(preview, action) {
    return new Promise(resolve => {
      const previousFocus = document.activeElement;
      const following = preview.followingCount > 1;
      const legacy = preview.source === 'legacy' && following;
      const dialog = document.createElement('dialog');
      dialog.id = 'task-action-dialog';
      dialog.className = 'task-action-dialog';
      dialog.dataset.action = action;
      dialog.dataset.source = preview.source;
      dialog.setAttribute('aria-labelledby', 'task-action-title');
      dialog.setAttribute('aria-describedby', 'task-action-description');
      dialog.innerHTML = '<form class="task-action-form">' +
        '<div class="task-action-body">' +
        '<h2 id="task-action-title"></h2>' +
        '<div class="task-action-task"><strong id="task-action-task-title"></strong><span id="task-action-task-date"></span></div>' +
        '<p id="task-action-description"></p>' +
        '<p id="task-action-legacy-warning" class="task-action-warning" hidden></p>' +
        '<fieldset id="task-action-scope"><legend data-i18n="处理范围">处理范围</legend>' +
        '<label class="task-action-option"><input type="radio" name="task-action-scope" value="single" checked><span data-i18n="仅此项">仅此项</span><small data-i18n="1 项">1 项</small></label>' +
        '<label class="task-action-option"><input type="radio" name="task-action-scope" value="following"><span data-i18n="此项及后续">此项及后续</span><small id="task-action-following-count"></small></label>' +
        '</fieldset>' +
        '<details id="task-action-preview"><summary id="task-action-preview-label"></summary><ol id="task-action-items"></ol></details>' +
        '<p id="task-action-impact" aria-live="polite"></p>' +
        '<p id="task-action-error" role="alert" tabindex="-1"></p>' +
        '</div>' +
        '<div class="task-action-footer"><button type="button" id="task-action-cancel" data-i18n="取消">取消</button><button type="submit" id="task-action-confirm"></button></div>' +
        '</form>';
      const get = selector => dialog.querySelector(selector);
      const form = get('form'), confirm = get('#task-action-confirm'), cancel = get('#task-action-cancel');
      const inputs = [...dialog.querySelectorAll('input[name="task-action-scope"]')];
      let saving = false, settled = false, saveError = '';
      get('#task-action-task-title').textContent = preview.task.title;
      get('#task-action-task-date').textContent = preview.task.date + ' · ' + preview.task.time;
      get('#task-action-scope').hidden = !following;
      get('#task-action-preview').hidden = !following;
      get('#task-action-preview').open = legacy;
      get('#task-action-legacy-warning').hidden = !legacy;
      const itemLabels = [];
      function translateDialog() {
        i18n.apply(dialog);
        get('#task-action-title').textContent = tr(verbs[action] + (action === 'reopen' ? '？' : '计划？'));
        get('#task-action-description').textContent = tr(following
          ? preview.source === 'series'
            ? '按重复顺序处理，改期事项仍保留原顺序。下方清单显示实际日期。'
            : '后续范围按当前日期和时间排列。请选择本次要处理的范围。'
          : action === 'delete' ? '删除后，这项计划及其提醒记录将被移除。' : '本次仅处理这项计划。');
        get('#task-action-following-count').textContent = tr('{count} 项', { count: preview.followingCount });
        get('#task-action-preview-label').textContent = tr('核对此项及后续（{count} 项）', { count: preview.followingCount });
        get('#task-action-legacy-warning').textContent = tr('旧版未保存分组，以下为同次创建且内容匹配的候选，请核对后批量处理。');
        for (const { item, meta } of itemLabels) {
          meta.textContent = item.date + ' · ' + item.time + ' · ' + tr(item.done ? '已完成' : '待办') + (item.id === preview.task.id ? ' · ' + tr('当前项') : '');
        }
        get('#task-action-error').textContent = saveError ? tr('操作未保存：{error}', { error: i18n.translateError(saveError) }) : '';
        updateImpact();
      }
      const fragment = document.createDocumentFragment();
      for (const item of preview.items || []) {
        const li = document.createElement('li');
        li.dataset.taskId = item.id;
        const title = document.createElement('strong'), meta = document.createElement('span');
        title.textContent = item.title;
        itemLabels.push({ item, meta });
        li.append(title, meta);
        fragment.append(li);
      }
      get('#task-action-items').append(fragment);
      function scope() { return following && inputs[1].checked ? 'following' : 'single'; }
      function updateImpact() {
        const multiple = scope() === 'following', count = multiple ? preview.followingCount : 1;
        get('#task-action-impact').textContent = tr('将' + verbs[action] + (count === 1 ? ' 1 项' : ' {count} 项') + (legacy && multiple ? '候选计划。' : '计划。'), { count });
        confirm.textContent = saving ? tr('正在保存…') : tr('确定' + verbs[action] + (multiple ? '（{count} 项）' : ''), { count });
      }
      function setSaving(value) {
        saving = value;
        dialog.setAttribute('aria-busy', String(value));
        cancel.disabled = confirm.disabled = value;
        inputs.forEach(input => { input.disabled = value; });
        updateImpact();
      }
      function finish(value) {
        if (settled) return;
        settled = true;
        window.removeEventListener('weeklight-language-changed', translateDialog);
        if (dialog.open) dialog.close();
        dialog.remove();
        if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
        resolve(value);
      }
      inputs.forEach(input => input.addEventListener('change', updateImpact));
      cancel.onclick = () => { if (!saving) finish(null); };
      dialog.addEventListener('cancel', event => {
        event.preventDefault();
        if (!saving) finish(null);
      });
      dialog.addEventListener('close', () => { if (!settled && !saving) finish(null); });
      form.onsubmit = async event => {
        event.preventDefault();
        if (saving) return;
        const selectedScope = scope();
        saveError = '';
        get('#task-action-error').textContent = '';
        setSaving(true);
        try {
          const result = await api.applyTaskAction({ id: preview.task.id, action, scope: selectedScope, token: selectedScope === 'following' ? preview.token : preview.singleToken });
          finish(result);
        } catch (error) {
          setSaving(false);
          saveError = errorText(error);
          get('#task-action-error').textContent = tr('操作未保存：{error}', { error: i18n.translateError(saveError) });
          get('#task-action-error').focus({ preventScroll: false });
        }
      };
      translateDialog();
      window.addEventListener('weeklight-language-changed', translateDialog);
      document.body.append(dialog);
      dialog.showModal();
      if (following) inputs[0].focus({ preventScroll: true });
      else cancel.focus();
    });
  }

  async function act(id, action) {
    if (!Object.hasOwn(verbs, action)) throw new Error(tr('操作无效'));
    if (active) return null;
    active = true;
    try {
      const preview = await api.previewTaskAction(id, action);
      if (!preview?.task) throw new Error(tr('计划不存在，请刷新后重试'));
      if (action !== 'delete' && preview.followingCount <= 1) {
        return await api.applyTaskAction({ id: preview.task.id, action, scope: 'single', token: preview.singleToken });
      }
      return await ask(preview, action);
    } finally {
      active = false;
    }
  }
  window.WeeklightTaskActions = Object.freeze({ act });
})();
