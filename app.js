const app = (() => {
  // ========== Supabase 初始化 ==========
  const { createClient } = window.supabase;
  const cfg = window.SUPABASE_CONFIG || {};
  const supabase = createClient(cfg.url || '', cfg.anonKey || '', {
    // 会话存于 sessionStorage：同一标签页刷新保持登录，关闭标签页/重新打开需重新登录
    auth: { persistSession: true, autoRefreshToken: true, storage: window.sessionStorage }
  });

  // 变电所数据
  const substations = {
    '金义线': [
      '金华站变电所','金华站物业跟随所','双溪西路站变电所','八一南街站变电所',
      '八一南街站物业跟随所','万达广场站变电所','万大区间跟随所','大堰河街站变电所',
      '轨道大厦站变电所','轨金区间跟随所','金华南站变电所','金塘区间混合所1',
      '金塘区间跟随所1','金塘区间混合所2','金塘区间跟随所2','塘雅站变电所',
      '车辆段站变电所','综保区站变电所','新区站变电所','东华街站变电所',
      '东义区间跟随所','东义区间混合所1','东义区间混合所2','义亭站变电所',
      '义官区间混合所','官塘站变电所','稠江站变电所','绣湖站变电所',
      '绣秦区间跟随所','秦塘站变电所','塘雅车辆段变电所','塘雅车辆段检修库跟随所',
      '塘雅车辆段综合楼跟随所','官塘停车场变电所','官塘停车场综合楼跟随所',
      '官塘停车场运用库跟随所','35kV王塘变电所','35kV综保变电所','35kV稠义变电所',
      '控制中心变电所','控制中心主楼跟随所'
    ],
    '义东线': [
      '义乌高铁站变电所','凌云站变电所','春秦区间跟随所','春晗站变电所',
      '国际商贸城站变电所','浙医四院站变电所','江东站变电所','江木区间混合所',
      '木雕城站变电所','歌山路站变电所','人民路站变电所','人会区间跟随所',
      '会展中心站变电所','体育馆站变电所','体横区间混合所','体横区间跟随所',
      '横店高铁站变电所','横明区间跟随所','横明区间混合所1','横明区间混合所2',
      '明清宫站变电所','后宅停车场变电所','后宅停车场运用库跟随所','槐堂停车场变电所',
      '槐堂停车场出入线跟随所','35kV王阳光变电所','35kV陈塘变电所'
    ]
  };

  // ========== 状态 ==========
  let state = {
    tickets: [],
    query: { workType: '', workCode: '', executeDate: '', workContent: '' },
    pagination: { page: 1, pageSize: 10, total: 0 },
    editingId: null,
    formReadonly: false,
    formItems: [],
    currentUser: null,  // { id, username, name, role }
  };

  // ========== 工具函数 ==========
  const $ = (id) => document.getElementById(id);
  const pad = (n) => String(n).padStart(2, '0');
  const formatDate = (d) => {
    if (!d) return '';
    const date = new Date(d);
    if (isNaN(date)) return d;
    return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };
  const formatDateOnly = (d) => {
    if (!d) return '';
    const date = new Date(d);
    if (isNaN(date)) return d;
    return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
  };
  const toDatetimeLocal = (d) => {
    if (!d) return '';
    const date = new Date(d);
    if (isNaN(date)) return d.slice(0,16);
    return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };
  const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}`;
  };

  // 指令票编号（后端保存时也会自动补号）
  const generateTicketNo = () => {
    return `JYD${todayStr()}${String(state.tickets.filter(t => (t.ticketNo||'').startsWith('JYD'+todayStr())).length + 1).padStart(3, '0')}`;
  };

  const getLineCode = (lineName) => lineName === '义东线' ? '2' : '1';

  // 命令号自增（查已有 tickets 的 items）
  const nextCommandNo = (lineCode, type) => {
    const min = type === 'switch' ? 301 : 501;
    const max = type === 'switch' ? 399 : 599;
    const prefix = `${lineCode}`;
    const used = state.tickets.flatMap(t => t.items || [])
      .filter(item => {
        if (!item.commandNo || !item.commandNo.startsWith(prefix)) return false;
        if (type === 'switch' && item.commandType !== '倒闸命令') return false;
        if (type === 'work' && item.commandType !== '作业命令') return false;
        return true;
      })
      .map(item => parseInt(item.commandNo.slice(1), 10))
      .filter(n => !isNaN(n) && n >= min && n <= max);
    let next = min;
    if (used.length > 0) {
      const maxUsed = Math.max(...used);
      next = maxUsed >= max ? min : maxUsed + 1;
    }
    return `${prefix}${next}`;
  };

  // ========== Supabase 封装 ==========
  const alertErr = (op, err) => {
    console.error(`[${op}]`, err);
    alert(`操作失败：${op}\n${err?.message || err}`);
  };

  // 把 supabase 返回的 tickets 行（snake_case）转成前端需要的对象
  const rowToTicket = (r) => ({
    id: r.id,
    ticketNo: r.ticket_no,
    workContent: r.work_content,
    workCode: r.work_code,
    workType: r.work_type,
    creator: r.creator,
    reviewer: r.reviewer,
    createdBy: r.created_by,     // uuid 字符串
    createDate: r.create_date,
    executeDate: r.execute_date,
    status: r.status,
    items: Array.isArray(r.items_json) ? r.items_json : (r.items_json ? [] : []),
  });

  // 反向
  const ticketToRow = (t) => ({
    id: t.id,
    ticket_no: t.ticketNo,
    work_content: t.workContent,
    work_code: t.workCode,
    work_type: t.workType,
    creator: t.creator,
    reviewer: t.reviewer,
    created_by: state.currentUser?.id || null,
    create_date: t.createDate,
    execute_date: t.executeDate,
    status: t.status,
    items_json: t.items,
  });

  // ========== 列表加载 ==========
  const loadTickets = async () => {
    try {
      let query = supabase.from('tickets').select('*');
      if (state.query.workType) query = query.eq('work_type', state.query.workType);
      if (state.query.workCode) query = query.ilike('work_code', `%${state.query.workCode}%`);
      if (state.query.executeDate) {
        // execute_date 是 timestamptz 类型，不能用 ilike（PostgREST 会报 42883）；
        // 且入库时存的是所选日期的 UTC 零点，按 [当日0点, 次日0点) 区间查询
        const start = `${state.query.executeDate}T00:00:00Z`;
        const end = new Date(Date.parse(start) + 86400000).toISOString();
        query = query.gte('execute_date', start).lt('execute_date', end);
      }
      if (state.query.workContent) query = query.ilike('work_content', `%${state.query.workContent}%`);
      query = query.order('create_date', { ascending: false });
      const { data, error } = await query;
      if (error) throw error;
      state.tickets = (data || []).map(rowToTicket);
    } catch (e) {
      alertErr('加载指令票', e);
    }
  };

  // ========== 列表渲染 ==========
  const renderList = () => {
    const list = state.tickets;
    state.pagination.total = list.length;
    const start = (state.pagination.page - 1) * state.pagination.pageSize;
    const pageData = list.slice(start, start + state.pagination.pageSize);
    const tbody = $('ticket-list');
    $('total-count').textContent = list.length;

    if (pageData.length === 0) {
      tbody.innerHTML = `<tr><td colspan="11"><div class="empty-state"><p>暂无数据</p><p>点击"新增指令票"开始创建</p></div></td></tr>`;
      renderPagination(0);
      return;
    }

    tbody.innerHTML = pageData.map((t, idx) => {
      const globalIndex = start + idx + 1;
      const statusClass = t.status === '已完成' ? 'badge-done' : 'badge-undone';
      const items = t.items || [];
      const switchNos = items.filter(it => it.commandType === '倒闸命令' && it.commandNo).map(it => it.commandNo).join(', ');
      const workNos = items.filter(it => it.commandType === '作业命令' && it.commandNo).map(it => it.commandNo).join(', ');
      return `
        <tr>
          <td>${globalIndex}</td>
          <td><span class="ticket-link" onclick="app.viewTicket('${t.id}')">${t.ticketNo}</span></td>
          <td class="col-work-content" title="${t.workContent}">${t.workContent || ''}</td>
          <td>${t.workCode || ''}</td>
          <td>${t.workType || ''}</td>
          <td>${switchNos}</td>
          <td>${workNos}</td>
          <td>${formatDateOnly(t.createDate)}</td>
          <td>${formatDateOnly(t.executeDate)}</td>
          <td><span class="badge ${statusClass}">${t.status || '未完成'}</span></td>
          <td class="col-actions-cell">
            <div class="col-actions">
              <button class="btn btn-default" onclick="app.viewTicket('${t.id}')">查看</button>
              ${canModify(t) ? `<button class="btn btn-default" onclick="app.editTicket('${t.id}')">编辑</button><button class="btn btn-danger" onclick="app.deleteTicket('${t.id}')">删除</button>` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');
    renderPagination(list.length);
  };

  const renderPagination = (total) => {
    const pages = Math.ceil(total / state.pagination.pageSize) || 1;
    const p = state.pagination.page;
    let html = '';
    html += `<button onclick="app.goPage(${p-1})" ${p===1?'disabled':''}>上一页</button>`;
    for (let i = 1; i <= pages; i++) {
      if (i === 1 || i === pages || (i >= p-2 && i <= p+2)) {
        html += `<button class="${i===p?'active':''}" onclick="app.goPage(${i})">${i}</button>`;
      } else if (i === p-3 || i === p+3) {
        html += `<span>...</span>`;
      }
    }
    html += `<button onclick="app.goPage(${p+1})" ${p===pages?'disabled':''}>下一页</button>`;
    html += `<span style="margin-left:8px;color:#6b7280;font-size:13px">第 ${p}/${pages} 页</span>`;
    $('pagination').innerHTML = html;
  };

  // ========== 表单视图 ==========
  const showForm = (id = null, readonly = false) => {
    if (id && !readonly) {
      const t = state.tickets.find(x => x.id === id);
      if (!canModify(t)) {
        alert('您只能编辑自己创建的指令票');
        return;
      }
    }
    state.editingId = id;
    state.formReadonly = readonly;
    $('list-view').classList.add('hidden');
    $('form-view').classList.remove('hidden');

    const t = id ? state.tickets.find(x => x.id === id) : null;
    state.formItems = t ? JSON.parse(JSON.stringify(t.items || [])) : [];
    state.formItems.forEach(it => {
      if (it.commandType === '倒闸操作') {
        if (!it.operationContents) {
          it.operationContents = it.operationContent ? [{ content: it.operationContent }] : [{ content: '' }];
        }
      } else {
        if (!it.commandContents) {
          it.commandContents = it.commandContent ? [{ content: it.commandContent }] : [{ content: '' }];
        }
      }
    });

    $('t-work-content').value = t ? t.workContent : '';
    $('t-work-code').value = t ? (t.workCode || '') : '';
    $('t-work-type').value = t ? t.workType : '';
    $('t-ticket-no').value = t ? t.ticketNo : '';  // 后端自动编号
    $('t-creator').value = t ? t.creator : (state.currentUser ? state.currentUser.name : '');
    $('t-reviewer').value = t ? (t.reviewer || '') : '';
    $('t-create-date').value = t ? toDatetimeLocal(t.createDate) : toDatetimeLocal(new Date());
    $('t-execute-date').value = t ? formatDateOnly(t.executeDate) : '';

    renderItems();
    setFormReadonly(readonly);
    $('btn-save').style.display = readonly ? 'none' : '';
    $('btn-print').style.display = '';
  };

  const setFormReadonly = (readonly) => {
    const inputs = document.querySelectorAll('#ticket-sheet input, #ticket-sheet select, #ticket-sheet textarea');
    inputs.forEach(el => {
      if (readonly) el.setAttribute('disabled', 'disabled');
      else if (el.id !== 't-ticket-no') el.removeAttribute('disabled');
    });
    document.querySelectorAll('.item-actions .btn, .btn-add-item').forEach(el => {
      el.style.display = readonly ? 'none' : '';
    });
  };

  const renderItems = () => {
    const container = $('items-container');
    const items = state.formItems;
    if (!items || items.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>暂无指令项，请点击下方按钮添加</p></div>';
      return;
    }
    // 序号统一从 1 开始（各交互处理均以 seqNo - 1 作为数组下标）
    items.forEach((it, i) => { it.seqNo = i + 1; });
    container.innerHTML = items.map((item, i) => renderItemCard(item, i + 1)).join('');
    items.forEach((item, i) => bindItemEvents(item, i + 1));
  };

  const renderItemCard = (item, seqNo) => {
    const baseHeader = `
      <div class="item-header">
        <span class="item-seq">${seqNo}</span>
        <span class="item-type">
          <select class="item-type-select" data-seq="${seqNo}" ${state.formReadonly?'disabled':''}>
            <option value="倒闸操作" ${item.commandType==='倒闸操作'?'selected':''}>倒闸操作</option>
            <option value="倒闸命令" ${item.commandType==='倒闸命令'?'selected':''}>倒闸命令</option>
            <option value="作业命令" ${item.commandType==='作业命令'?'selected':''}>作业命令</option>
          </select>
        </span>
        <div class="item-actions">
          <button class="btn btn-danger" onclick="app.removeItem(${seqNo})">删除</button>
        </div>
      </div>
    `;

    let body = '';
    if (item.commandType === '倒闸操作') {
      const ops = item.operationContents || [{ content: '' }];
      body = `
        <div class="item-body">
          <div class="form-row">
            <div class="form-group" style="flex:2.5">
              <label>操作内容</label>
              <div class="content-list" data-seq="${seqNo}" data-field="operationContents">
                ${ops.map((c, ci) => `
                  <div class="content-item">
                    <textarea class="content-text" data-seq="${seqNo}" data-field="operationContents" data-index="${ci}" placeholder="手动填写" ${state.formReadonly?'disabled':''}>${c.content || ''}</textarea>
                    ${!state.formReadonly ? `<button type="button" class="btn btn-content-del" onclick="app.removeContent(${seqNo}, 'operationContents', ${ci})" title="删除">×</button>` : ''}
                  </div>
                `).join('')}
                ${!state.formReadonly ? `<button type="button" class="btn btn-add-content" onclick="app.addContent(${seqNo}, 'operationContents')">+ 新增操作内容</button>` : ''}
              </div>
            </div>
            <div class="form-group">
              <label>操作人</label>
              <input type="text" class="item-operator" data-seq="${seqNo}" value="${item.operator || ''}" placeholder="手动填写" ${state.formReadonly?'disabled':''}>
            </div>
            <div class="form-group">
              <label>监护人</label>
              <input type="text" class="item-supervisor" data-seq="${seqNo}" value="${item.supervisor || ''}" placeholder="手动填写" ${state.formReadonly?'disabled':''}>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>操作时间</label>
              <input type="datetime-local" class="item-operation-time" data-seq="${seqNo}" value="${toDatetimeLocal(item.operationTime)}" ${state.formReadonly?'disabled':''}>
            </div>
            <div class="form-group">
              <label>完成时间</label>
              <input type="datetime-local" class="item-finish-time" data-seq="${seqNo}" value="${toDatetimeLocal(item.finishTime)}" ${state.formReadonly?'disabled':''}>
            </div>
          </div>
        </div>
      `;
    } else if (item.commandType === '倒闸命令') {
      body = `
        <div class="item-body">
          <div class="form-row">
            <div class="form-group">
              <label>命令号码</label>
              <input type="text" class="item-command-no" data-seq="${seqNo}" value="${item.commandNo || ''}" ${state.formReadonly?'disabled':''}>
              <span class="hint">点击"发令时间"自动生成，可手动修改（范围：X301-X399）</span>
            </div>
            <div class="form-group">
              <label>发令时间</label>
              <input type="datetime-local" class="item-issue-time" data-seq="${seqNo}" value="${toDatetimeLocal(item.issueTime)}" ${state.formReadonly?'disabled':''}>
            </div>
            <div class="form-group" style="flex:1.8">
              <label>受令地点</label>
              <div class="location-select">
                <select class="item-receive-line" data-seq="${seqNo}" ${state.formReadonly?'disabled':''}>
                  <option value="">选择线路</option>
                  <option value="金义线" ${item.receiveLocationLine==='金义线'?'selected':''}>金义线</option>
                  <option value="义东线" ${item.receiveLocationLine==='义东线'?'selected':''}>义东线</option>
                </select>
                <select class="item-receive-sub" data-seq="${seqNo}" ${state.formReadonly?'disabled':''}>
                  <option value="">选择变电所</option>
                </select>
              </div>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group" style="flex:2">
              <label>命令内容</label>
              <div class="content-list" data-seq="${seqNo}" data-field="commandContents">
                ${(item.commandContents || [{ content: '' }]).map((c, ci) => `
                  <div class="content-item">
                    <textarea class="content-text" data-seq="${seqNo}" data-field="commandContents" data-index="${ci}" placeholder="手动填写" ${state.formReadonly?'disabled':''}>${c.content || ''}</textarea>
                    ${!state.formReadonly ? `<button type="button" class="btn btn-content-del" onclick="app.removeContent(${seqNo}, 'commandContents', ${ci})" title="删除">×</button>` : ''}
                  </div>
                `).join('')}
                ${!state.formReadonly ? `<button type="button" class="btn btn-add-content" onclick="app.addContent(${seqNo}, 'commandContents')">+ 新增命令内容</button>` : ''}
              </div>
            </div>
            <div class="form-group">
              <label>发令人</label>
              <input type="text" class="item-issuer" data-seq="${seqNo}" value="${item.issuer || ''}" placeholder="手动填写" ${state.formReadonly?'disabled':''}>
            </div>
            <div class="form-group">
              <label>受令人</label>
              <input type="text" class="item-receiver" data-seq="${seqNo}" value="${item.receiver || ''}" placeholder="手动填写" ${state.formReadonly?'disabled':''}>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>批准时间</label>
              <input type="datetime-local" class="item-approve-time" data-seq="${seqNo}" value="${toDatetimeLocal(item.approveTime)}" ${state.formReadonly?'disabled':''}>
            </div>
            <div class="form-group">
              <label>完成时间</label>
              <input type="datetime-local" class="item-finish-time" data-seq="${seqNo}" value="${toDatetimeLocal(item.finishTime)}" ${state.formReadonly?'disabled':''}>
            </div>
          </div>
        </div>
      `;
    } else if (item.commandType === '作业命令') {
      body = `
        <div class="item-body">
          <div class="form-row">
            <div class="form-group">
              <label>命令号码</label>
              <input type="text" class="item-command-no" data-seq="${seqNo}" value="${item.commandNo || ''}" ${state.formReadonly?'disabled':''}>
              <span class="hint">点击"发令时间"自动生成，可手动修改（范围：X501-X599）</span>
            </div>
            <div class="form-group">
              <label>发令时间</label>
              <input type="datetime-local" class="item-issue-time" data-seq="${seqNo}" value="${toDatetimeLocal(item.issueTime)}" ${state.formReadonly?'disabled':''}>
            </div>
            <div class="form-group">
              <label>要求完成时间</label>
              <input type="datetime-local" class="item-required-time" data-seq="${seqNo}" value="${toDatetimeLocal(item.requiredFinishTime)}" ${state.formReadonly?'disabled':''}>
            </div>
            <div class="form-group">
              <label>作业地点</label>
              <select class="item-work-location" data-seq="${seqNo}" ${state.formReadonly?'disabled':''}>
                <option value="">选择线路</option>
                <option value="金义线" ${item.workLocation==='金义线'?'selected':''}>金义线</option>
                <option value="义东线" ${item.workLocation==='义东线'?'selected':''}>义东线</option>
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group" style="flex:2">
              <label>命令内容</label>
              <div class="content-list" data-seq="${seqNo}" data-field="commandContents">
                ${(item.commandContents || [{ content: '' }]).map((c, ci) => `
                  <div class="content-item">
                    <textarea class="content-text" data-seq="${seqNo}" data-field="commandContents" data-index="${ci}" placeholder="手动填写" ${state.formReadonly?'disabled':''}>${c.content || ''}</textarea>
                    ${!state.formReadonly ? `<button type="button" class="btn btn-content-del" onclick="app.removeContent(${seqNo}, 'commandContents', ${ci})" title="删除">×</button>` : ''}
                  </div>
                `).join('')}
                ${!state.formReadonly ? `<button type="button" class="btn btn-add-content" onclick="app.addContent(${seqNo}, 'commandContents')">+ 新增命令内容</button>` : ''}
              </div>
            </div>
            <div class="form-group">
              <label>发令人</label>
              <input type="text" class="item-issuer" data-seq="${seqNo}" value="${item.issuer || ''}" placeholder="手动填写" ${state.formReadonly?'disabled':''}>
            </div>
            <div class="form-group">
              <label>受令人</label>
              <input type="text" class="item-receiver" data-seq="${seqNo}" value="${item.receiver || ''}" placeholder="手动填写" ${state.formReadonly?'disabled':''}>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>批准时间</label>
              <input type="datetime-local" class="item-approve-time" data-seq="${seqNo}" value="${toDatetimeLocal(item.approveTime)}" ${state.formReadonly?'disabled':''}>
            </div>
            <div class="form-group">
              <label>完成时间</label>
              <input type="datetime-local" class="item-finish-time" data-seq="${seqNo}" value="${toDatetimeLocal(item.finishTime)}" ${state.formReadonly?'disabled':''}>
            </div>
          </div>
        </div>
      `;
    }
    return `<div class="item-card" data-seq="${seqNo}">${baseHeader}${body}</div>`;
  };

  const bindItemEvents = (item, seqNo) => {
    const card = document.querySelector(`.item-card[data-seq="${seqNo}"]`);
    if (!card) return;

    const typeSelect = card.querySelector('.item-type-select');
    typeSelect.addEventListener('change', (e) => {
      const newType = e.target.value;
      state.formItems[seqNo - 1] = { seqNo, commandType: newType };
      if (newType === '倒闸操作') {
        state.formItems[seqNo - 1].operationContents = [{ content: '' }];
      } else {
        state.formItems[seqNo - 1].commandContents = [{ content: '' }];
      }
      if (newType === '倒闸命令') {
        state.formItems[seqNo - 1].receiveLocationLine = '金义线';
      } else if (newType === '作业命令') {
        state.formItems[seqNo - 1].workLocation = '金义线';
      }
      renderItems();
    });

    const sync = (selector, key) => {
      const el = card.querySelector(selector);
      if (el) el.addEventListener('input', () => { state.formItems[seqNo - 1][key] = el.value; });
    };
    const bindContentList = (field) => {
      card.querySelectorAll(`.content-text[data-field="${field}"]`).forEach(el => {
        el.addEventListener('input', () => {
          const idx = parseInt(el.dataset.index, 10);
          if (state.formItems[seqNo - 1][field] && state.formItems[seqNo - 1][field][idx]) {
            state.formItems[seqNo - 1][field][idx].content = el.value;
          }
        });
      });
    };
    if (item.commandType === '倒闸操作') {
      bindContentList('operationContents');
      sync('.item-operator', 'operator');
      sync('.item-supervisor', 'supervisor');
      sync('.item-operation-time', 'operationTime');
      sync('.item-finish-time', 'finishTime');
    } else if (item.commandType === '倒闸命令') {
      sync('.item-command-no', 'commandNo');
      sync('.item-issue-time', 'issueTime');
      const issueTimeInput_switch = card.querySelector('.item-issue-time');
      if (issueTimeInput_switch) {
        issueTimeInput_switch.addEventListener('focus', () => {
          const cur = state.formItems[seqNo - 1];
          if (!cur.commandNo) {
            const line = cur.receiveLocationLine || '金义线';
            cur.commandNo = nextCommandNo(getLineCode(line), 'switch');
            const noInput = card.querySelector('.item-command-no');
            if (noInput) noInput.value = cur.commandNo;
          }
        });
      }
      bindContentList('commandContents');
      sync('.item-issuer', 'issuer');
      sync('.item-receiver', 'receiver');
      sync('.item-approve-time', 'approveTime');
      sync('.item-finish-time', 'finishTime');

      const lineSel = card.querySelector('.item-receive-line');
      const subSel = card.querySelector('.item-receive-sub');
      populateSubSelect(subSel, item.receiveLocationLine, item.receiveLocationSub);
      lineSel.addEventListener('change', () => {
        state.formItems[seqNo - 1].receiveLocationLine = lineSel.value;
        state.formItems[seqNo - 1].receiveLocationSub = '';
        populateSubSelect(subSel, lineSel.value, '');
        renderItems();
      });
      subSel.addEventListener('change', () => {
        state.formItems[seqNo - 1].receiveLocationSub = subSel.value;
      });
    } else if (item.commandType === '作业命令') {
      sync('.item-command-no', 'commandNo');
      sync('.item-issue-time', 'issueTime');
      const issueTimeInput_work = card.querySelector('.item-issue-time');
      if (issueTimeInput_work) {
        issueTimeInput_work.addEventListener('focus', () => {
          const cur = state.formItems[seqNo - 1];
          if (!cur.commandNo) {
            const line = cur.workLocation || '金义线';
            cur.commandNo = nextCommandNo(getLineCode(line), 'work');
            const noInput = card.querySelector('.item-command-no');
            if (noInput) noInput.value = cur.commandNo;
          }
        });
      }
      sync('.item-required-time', 'requiredFinishTime');
      bindContentList('commandContents');
      sync('.item-issuer', 'issuer');
      sync('.item-receiver', 'receiver');
      sync('.item-approve-time', 'approveTime');
      sync('.item-finish-time', 'finishTime');

      const locSel = card.querySelector('.item-work-location');
      locSel.addEventListener('change', () => {
        state.formItems[seqNo - 1].workLocation = locSel.value;
        renderItems();
      });
    }
  };

  const populateSubSelect = (selectEl, line, selectedSub) => {
    if (!selectEl) return;
    const subs = line ? substations[line] || [] : [];
    selectEl.innerHTML = '<option value="">选择变电所</option>' + subs.map(s => `<option value="${s}" ${s===selectedSub?'selected':''}>${s}</option>`).join('');
  };

  const addItem = () => {
    state.formItems.push({
      seqNo: state.formItems.length + 1,
      commandType: '倒闸操作',
      operationContents: [{ content: '' }]
    });
    renderItems();
  };

  const removeItem = (seqNo) => {
    state.formItems = state.formItems.filter((_, i) => i !== seqNo - 1);
    state.formItems.forEach((it, i) => it.seqNo = i + 1);
    renderItems();
  };

  const addContent = (seqNo, field) => {
    const item = state.formItems[seqNo - 1];
    if (!item[field]) item[field] = [];
    item[field].push({ content: '' });
    renderItems();
  };

  const removeContent = (seqNo, field, index) => {
    const item = state.formItems[seqNo - 1];
    if (item[field] && item[field].length > 1) {
      item[field].splice(index, 1);
      renderItems();
    } else if (item[field] && item[field].length === 1) {
      item[field][0].content = '';
      renderItems();
    }
  };

  // ========== 完成度校验 ==========
  const getMissingFields = (item) => {
    if (!item) return [];
    const hasValue = (v) => v !== undefined && v !== null && String(v).trim() !== '';
    const contentsOk = (arr) => Array.isArray(arr) && arr.length > 0 && arr.every(c => hasValue(c.content));
    const missing = [];
    if (item.commandType === '倒闸操作') {
      if (!contentsOk(item.operationContents)) missing.push('操作内容');
      if (!hasValue(item.operator)) missing.push('操作人');
      if (!hasValue(item.supervisor)) missing.push('监护人');
      if (!hasValue(item.operationTime)) missing.push('操作时间');
      if (!hasValue(item.finishTime)) missing.push('完成时间');
    } else if (item.commandType === '倒闸命令') {
      if (!hasValue(item.commandNo)) missing.push('命令号码');
      if (!hasValue(item.issueTime)) missing.push('发令时间');
      if (!hasValue(item.receiveLocationLine)) missing.push('受令地点-线路');
      if (!hasValue(item.receiveLocationSub)) missing.push('受令地点-变电所');
      if (!contentsOk(item.commandContents)) missing.push('命令内容');
      if (!hasValue(item.issuer)) missing.push('发令人');
      if (!hasValue(item.receiver)) missing.push('受令人');
      if (!hasValue(item.approveTime)) missing.push('批准时间');
      if (!hasValue(item.finishTime)) missing.push('完成时间');
    } else if (item.commandType === '作业命令') {
      if (!hasValue(item.commandNo)) missing.push('命令号码');
      if (!hasValue(item.issueTime)) missing.push('发令时间');
      if (!hasValue(item.requiredFinishTime)) missing.push('要求完成时间');
      if (!hasValue(item.workLocation)) missing.push('作业地点');
      if (!contentsOk(item.commandContents)) missing.push('命令内容');
      if (!hasValue(item.issuer)) missing.push('发令人');
      if (!hasValue(item.receiver)) missing.push('受令人');
      if (!hasValue(item.approveTime)) missing.push('批准时间');
      if (!hasValue(item.finishTime)) missing.push('完成时间');
    }
    return missing;
  };
  const isItemComplete = (item) => getMissingFields(item).length === 0;

  // ========== 保存 ==========
  const saveTicket = async () => {
    const workContent = $('t-work-content').value.trim();
    const workCode = $('t-work-code').value.trim();
    const workType = $('t-work-type').value;
    if (!workContent) { alert('请填写工作内容'); return; }
    if (!workType) { alert('请选择工作类型'); return; }
    if (state.formItems.length === 0) { alert('请至少添加一条指令明细'); return; }

    const items = state.formItems.map(it => ({ ...it }));
    const allFinish = items.length > 0 && items.every(it => isItemComplete(it));
    const status = allFinish ? '已完成' : '未完成';

    if (!allFinish) {
      const tips = [];
      items.forEach((it, idx) => {
        const missing = getMissingFields(it);
        if (missing.length > 0) {
          tips.push(`第 ${idx + 1} 项【${it.commandType}】未填写：${missing.join('、')}`);
        }
      });
      const msg = '以下内容尚未填写，保存后状态为"未完成"：\n\n' + tips.join('\n') + '\n\n是否继续保存？';
      if (!confirm(msg)) return;
    }

    const now = new Date();
    const datePart = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}`;

    if (state.editingId) {
      // 编辑：保留原编号
      const old = state.tickets.find(t => t.id === state.editingId);
      const payload = {
        work_content: workContent, work_code: workCode, work_type: workType,
        creator: $('t-creator').value, reviewer: $('t-reviewer').value,
        create_date: $('t-create-date').value ? new Date($('t-create-date').value).toISOString() : now.toISOString(),
        execute_date: $('t-execute-date').value ? new Date($('t-execute-date').value).toISOString() : '',
        status,
        items_json: items,
      };
      const { error } = await supabase.from('tickets').update(payload).eq('id', state.editingId);
      if (error) { alertErr('保存指令票', error); return; }
    } else {
      // 新建：先查当天已有几张，生成编号
      const { data: today, error: qerr } = await supabase
        .from('tickets').select('ticket_no').like('ticket_no', `JYD${datePart}%`);
      if (qerr) { alertErr('查询票号', qerr); return; }
      // 取当天已用编号的最大序号 +1，避免删除后重新生成重号
      const seq = (today || []).reduce((max, r) => {
        const n = parseInt(String(r.ticket_no || '').slice(-3), 10);
        return isNaN(n) ? max : Math.max(max, n);
      }, 0) + 1;
      const ticketNo = `JYD${datePart}${String(seq).padStart(3, '0')}`;

      const payload = {
        id: 'tid_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        ticket_no: ticketNo,
        work_content: workContent, work_code: workCode, work_type: workType,
        creator: $('t-creator').value, reviewer: $('t-reviewer').value,
        created_by: state.currentUser?.id || null,
        create_date: $('t-create-date').value ? new Date($('t-create-date').value).toISOString() : now.toISOString(),
        execute_date: $('t-execute-date').value ? new Date($('t-execute-date').value).toISOString() : '',
        status, items_json: items,
      };
      const { error } = await supabase.from('tickets').insert(payload);
      if (error) { alertErr('保存指令票', error); return; }
    }

    await loadTickets();
    backToList();
  };

  const deleteTicket = async (id) => {
    const ticket = state.tickets.find(t => t.id === id);
    if (!canModify(ticket)) { alert('您只能删除自己创建的指令票'); return; }
    if (!confirm('确定删除该指令票？')) return;
    const { error } = await supabase.from('tickets').delete().eq('id', id);
    if (error) { alertErr('删除指令票', error); return; }
    await loadTickets();
    renderList();
  };

  const backToList = () => {
    $('form-view').classList.add('hidden');
    $('list-view').classList.remove('hidden');
    state.editingId = null;
    state.formReadonly = false;
    state.formItems = [];
    renderList();
  };

  const search = async () => {
    state.query.workType = $('q-work-type').value;
    state.query.workCode = $('q-work-code').value.trim();
    state.query.executeDate = $('q-execute-date').value;
    state.query.workContent = $('q-work-content').value.trim();
    state.pagination.page = 1;
    await loadTickets();
    renderList();
  };

  const resetQuery = async () => {
    $('q-work-type').value = '';
    $('q-work-code').value = '';
    $('q-execute-date').value = '';
    $('q-work-content').value = '';
    state.query = { workType: '', workCode: '', executeDate: '', workContent: '' };
    state.pagination.page = 1;
    await loadTickets();
    renderList();
  };

  const changePageSize = () => {
    state.pagination.pageSize = parseInt($('page-size').value, 10);
    state.pagination.page = 1;
    renderList();
  };

  const goPage = (p) => {
    const max = Math.ceil(state.pagination.total / state.pagination.pageSize) || 1;
    if (p < 1 || p > max) return;
    state.pagination.page = p;
    renderList();
  };

  // 打印前强制隐藏看板与列表（内联 !important 优先级最高，确保任何浏览器下都不打印看板内容）
  const printTicket = () => {
    const hiddenViews = [$('list-view'), $('dashboard-view')].filter(Boolean);
    hiddenViews.forEach(el => el.style.setProperty('display', 'none', 'important'));
    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      hiddenViews.forEach(el => el.style.removeProperty('display'));
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);
    window.print();
    setTimeout(restore, 800);
  };

  // ========== 登录鉴权 ==========
  const login = async () => {
    const username = $('login-username').value.trim();
    const password = $('login-password').value;
    const err = $('login-error');
    if (!username || !password) { err.textContent = '请输入用户名和密码'; return; }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: `${username}@jinhua-rail.com`,
        password,
      });
      if (error) {
        err.textContent = error.message.includes('Invalid') ? '用户名或密码错误' : error.message;
        return;
      }
      await loadCurrentUser();
      updateUserInfo();
      $('login-overlay').classList.add('hidden');
      $('login-username').value = '';
      $('login-password').value = '';
      err.textContent = '';
      await loadTickets();
      renderList();
    } catch (e) {
      err.textContent = '登录失败：' + (e.message || e);
    }
  };

  const logout = async () => {
    if (window.AppDashboard) window.AppDashboard.hide();
    await supabase.auth.signOut();
    state.currentUser = null;
    state.tickets = [];
    updateUserInfo();
    $('login-overlay').classList.remove('hidden');
    $('dashboard-view').classList.add('hidden');
    $('form-view').classList.add('hidden');
    $('list-view').classList.remove('hidden');
    setHeaderMode(false);
  };

  // 从 auth session + profiles 表拼装 currentUser
  const loadCurrentUser = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) { state.currentUser = null; return; }
    const authUser = session.user;
    // 查 profiles
    const { data: profiles, error } = await supabase
      .from('profiles').select('*').eq('id', authUser.id).limit(1);
    if (error) { console.warn('查 profiles 失败', error); }
    const p = (profiles && profiles[0]) || {};
    const username = authUser.email?.split('@')[0] || p.username || '';
    state.currentUser = {
      id: authUser.id,
      username: p.username || username,
      name: p.name || authUser.user_metadata?.name || username,
      role: p.role || 'user',
    };
  };

  const updateUserInfo = () => {
    const el = $('user-info');
    if (el) el.textContent = state.currentUser ? `欢迎，${state.currentUser.name}` : '';
  };

  const canModify = (ticket) => {
    if (!ticket) return false;
    if (state.currentUser && state.currentUser.role === 'admin') return true;
    return state.currentUser && ticket.createdBy === state.currentUser.id;
  };

  // ========== 综合看板 ==========
  const showDashboard = async () => {
    $('list-view').classList.add('hidden');
    $('form-view').classList.add('hidden');
    $('dashboard-view').classList.remove('hidden');
    setHeaderMode(true);
    // 调看板模块初始化
    if (window.AppDashboard) window.AppDashboard.show();
  };

  const showList = () => {
    if (window.AppDashboard) window.AppDashboard.hide();
    $('dashboard-view').classList.add('hidden');
    $('form-view').classList.add('hidden');
    $('list-view').classList.remove('hidden');
    setHeaderMode(false);
  };

  // ========== 时钟 ==========
  const updateClock = () => {
    const el = $('current-time');
    if (!el) return;
    const now = new Date();
    const opts = { timeZone: 'Asia/Shanghai' };
    const date = new Intl.DateTimeFormat('zh-CN', { ...opts, year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(now).replace(/\//g, '-');
    const week = new Intl.DateTimeFormat('zh-CN', { ...opts, weekday: 'long' }).format(now);
    const time = new Intl.DateTimeFormat('zh-CN', { ...opts, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
      .format(now);
    el.textContent = `${date} ${week} ${time}`;
  };

  // 顶栏模式：仅综合看板页隐藏 logo/账号/退出并显示北京时间与返回，其他页面保持原样
  const setHeaderMode = (isDashboard) => {
    const header = $('app-header');
    if (!header) return;
    header.classList.toggle('is-dashboard', !!isDashboard);
    const title = header.querySelector('.header-title');
    if (title) {
      title.textContent = isDashboard
        ? '金华市轨道交通供电系统调度操作指令票系统综合看板'
        : '金华市轨道交通供电系统调度操作指令票系统';
    }
  };

  // ========== 启动 ==========
  const init = async () => {
    updateClock();
    setInterval(updateClock, 1000);

    // 等待 Supabase SDK 加载
    if (!window.supabase) {
      alert('Supabase SDK 未加载，请检查网络或 index.html');
      return;
    }
    if (!cfg.url || cfg.url.includes('YOUR-PROJECT-REF')) {
      $('login-overlay').classList.remove('hidden');
      $('login-error').textContent = '请先在 config.js 中配置 Supabase 项目参数';
      return;
    }

    // 清理旧版本遗留在 localStorage 的登录令牌（本版本会话只存于 sessionStorage）
    try {
      Object.keys(localStorage)
        .filter(k => k.startsWith('sb-') && k.includes('auth-token'))
        .forEach(k => localStorage.removeItem(k));
    } catch (e) { console.warn('清理本地登录令牌失败', e); }

    // 订阅 Auth 状态变化
    supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        await loadCurrentUser();
        updateUserInfo();
        $('login-overlay').classList.add('hidden');
        await loadTickets();
        renderList();
      } else if (event === 'SIGNED_OUT') {
        state.currentUser = null;
        state.tickets = [];
        updateUserInfo();
        $('login-overlay').classList.remove('hidden');
      }
    });

    // 恢复当前标签页的会话：刷新页面保持登录状态
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      await loadCurrentUser();
      await loadTickets();
      renderList();
      $('login-overlay').classList.add('hidden');
    } else {
      $('login-overlay').classList.remove('hidden');
    }
    updateUserInfo();

    const pwdInput = $('login-password');
    if (pwdInput) pwdInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
  };

  return {
    init,
    showForm: () => showForm(),
    viewTicket: (id) => showForm(id, true),
    editTicket: (id) => showForm(id, false),
    deleteTicket,
    saveTicket,
    backToList,
    search, resetQuery, changePageSize, goPage,
    addItem, removeItem, addContent, removeContent,
    printTicket,
    login, logout,
    showDashboard, showList,
  };
})();

document.addEventListener('DOMContentLoaded', app.init);
