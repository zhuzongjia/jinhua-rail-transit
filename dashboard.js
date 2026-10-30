/* ============================================================
   综合看板模块 · 白色清爽风（与主系统风格一致）
   布局：操作票管理 / 指令票全生命周期 / 工作类型分布 / 工作量趋势 / 安全合规预警
   暴露 window.AppDashboard = { show, hide }
   ============================================================ */

(() => {
  const { createClient } = window.supabase;
  const cfg = window.SUPABASE_CONFIG || {};
  const supabase = createClient(cfg.url || '', cfg.anonKey || '', {
    // 与主系统共用 sessionStorage 中的会话，保证看板查询同样处于登录态
    auth: { persistSession: true, autoRefreshToken: true, storage: window.sessionStorage }
  });

  const pad = (n) => String(n).padStart(2, '0');
  const fmtDate = (d) => {
    if (!d) return '';
    const x = new Date(d);
    if (isNaN(x)) return d.slice(0, 16).replace('T', ' ');
    return `${x.getFullYear()}-${pad(x.getMonth()+1)}-${pad(x.getDate())} ${pad(x.getHours())}:${pad(x.getMinutes())}`;
  };
  const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  };

  // 取本地时区的日期键（数据库里的时间存的是 UTC ISO，直接截取会和本地日期错位）
  const dateKey = (v) => {
    if (!v) return '';
    const d = new Date(v);
    if (isNaN(d)) return String(v).slice(0, 10);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  function rollingNumber(el, target, duration = 600) {
    if (!el) return;
    const start = parseInt(el.textContent, 10) || 0;
    const diff = target - start;
    if (diff === 0) return;
    const startTime = performance.now();
    function tick(now) {
      const t = Math.min((now - startTime) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      el.textContent = Math.round(start + diff * ease);
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  let charts = {};
  let refreshTimer = null;

  // 状态判定：以操作指令的时间为准
  //   已完成 —— 最后一个操作指令填了完成时间
  //   执行中 —— 未完成，但已有指令填了操作时间或批准时间
  //   未完成 —— 所有未完成的票（执行中 + 拟票完成）
  const isDone = (t) => ticketStage(t) === 'done';
  const isProgress = (t) => ticketStage(t) === 'progress';

  function ticketStage(t) {
    const items = parseItems(t);
    if (items.length) {
      const last = items[items.length - 1];
      if (last && last.finishTime) return 'done';
      const started = items.some(it => it.operationTime || it.approveTime || it.finishTime);
      return started ? 'progress' : 'draft';
    }
    // 无指令明细的旧票，回退到票面状态
    const s = t.status || '';
    if (s.includes('已完成')) return 'done';
    if (s.includes('执行中')) return 'progress';
    return 'draft';
  }

  async function loadAll() {
    const { data: allTickets, error } = await supabase.from('tickets').select('*');
    if (error) { console.error('[Dashboard] load tickets fail', error); return; }
    const tickets = allTickets || [];
    const today = todayStr();
    const month = today.slice(0, 7);
    const now = new Date();
    const todayTickets = tickets.filter(t => dateKey(t.create_date) === today);
    const monthTickets = tickets.filter(t => dateKey(t.create_date).startsWith(month));

    fillStats('today', summarize(todayTickets, now));
    fillStats('all', summarize(tickets, now));

    renderLifecycle(todayTickets, now);
    renderTrend(calcTrend(tickets, 7));
    setWorktypeLabels(now);
    renderWorktype('chart-worktype-today', calcWorktype(todayTickets), '今日暂无数据');
    renderWorktype('chart-worktype-month', calcWorktype(monthTickets), '本月暂无数据');
    renderAlerts(calcAlerts(tickets, now));
  }

  function summarize(list, now) {
    return {
      total: list.length,
      switch: list.filter(t => t.work_type === '倒闸操作').length,
      work: list.filter(t => t.work_type === '施工作业').length,
      progress: list.filter(t => isProgress(t, now)).length,
      undone: list.filter(t => !isDone(t)).length,
      done: list.filter(t => isDone(t)).length,
    };
  }

  function fillStats(prefix, s) {
    const set = (key, val) => {
      const el = document.querySelector(`[data-stat="${prefix}-${key}"]`);
      if (el) rollingNumber(el, val);
    };
    set('total', s.total);
    set('switch', s.switch);
    set('work', s.work);
    set('progress', s.progress);
    set('undone', s.undone);
    set('done', s.done);
  }

  function calcTrend(tickets, days) {
    const labels = []; const values = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
      labels.push(`${pad(d.getMonth()+1)}-${pad(d.getDate())}`);
      values.push(tickets.filter(t => dateKey(t.create_date) === key).length);
    }
    return { labels, values };
  }
  function calcWorktype(tickets) {
    const cnt = {};
    tickets.forEach(t => { const w = t.work_type || '未分类'; cnt[w] = (cnt[w] || 0) + 1; });
    return Object.entries(cnt).map(([name, value]) => ({ name, value }));
  }
  // 判断是否为有效操作任务（过滤表单里的空白占位行）
  function isFilledItem(it) {
    if (!it || typeof it !== 'object') return false;
    const hasContent = (arr) => Array.isArray(arr) && arr.some(c => (typeof c === 'string' ? c : (c && c.content) || '').trim());
    if (it.operationTime || it.approveTime || it.finishTime || it.issueTime || it.requiredFinishTime) return true;
    if (hasContent(it.operationContents) || hasContent(it.commandContents)) return true;
    return Object.keys(it).some(k => k !== 'seqNo' && typeof it[k] === 'string' && it[k].trim());
  }

  // 解析指令明细
  function parseItems(t) {
    let v = t.items_json;
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { v = []; } }
    if (!Array.isArray(v)) v = [];
    return v.filter(isFilledItem).sort((a, b) => (a.seqNo || 0) - (b.seqNo || 0));
  }

  // 正在执行中的任务的操作时间 / 批准时间；只拟票完成、没有这两个时间的票不计入逾期
  function progressTime(t) {
    const items = parseItems(t);
    for (const it of items) {
      if (it.finishTime) continue;
      const s = it.operationTime || it.approveTime;
      if (!s) continue;
      const d = new Date(s);
      if (!isNaN(d)) return d;
    }
    return null;
  }

  function calcAlerts(tickets, now) {
    const alerts = [];
    // 逾期：按执行中任务的操作时间 / 批准时间倒计时
    tickets.forEach(t => {
      if (isDone(t)) return;
      const base = progressTime(t);
      if (!base || base >= now) return;
      const minsLate = Math.floor((now - base) / 60000);
      alerts.push({ level: 'danger', text: `指令票 ${t.ticket_no}（${t.work_content || ''}）逾期 ${minsLate} 分钟未执行`, time: fmtDate(base) });
    });
    tickets.forEach(t => {
      if (t.creator && t.reviewer && t.creator === t.reviewer) {
        alerts.push({ level: 'warn', text: `指令票 ${t.ticket_no} 存在自拟自核（${t.creator}）`, time: fmtDate(t.create_date) });
      }
    });
    return alerts.slice(0, 8);
  }

  function ensureChart(id) {
    const el = document.getElementById(id);
    if (!el) return null;
    if (charts[id]) return charts[id];
    charts[id] = echarts.init(el, null, { renderer: 'canvas' });
    return charts[id];
  }

  /* ============ 白色清爽风 ECharts 配置 ============ */

  // 指令票全生命周期：表格展示「指令票编号 / 执行进度」两列，单张票一条横向进度条
  // 进度规则：拟票完成 30%（蓝）→ 按顺序每完成一个操作任务均分剩余 70%（橙，4 个任务即每完成 1 个 +17.5%）→ 全部完成 100%（绿）
  function lifecycleProgress(t, now) {
    const items = parseItems(t);
    const n = items.length;
    let pct;
    let stage;

    if (isDone(t)) {
      pct = 100;
      stage = 'done';
    } else if (n === 0) {
      pct = 30;
      stage = 'draft';
    } else if (n === 1) {
      // 单个操作任务：有操作时间/批准时间即进入执行（70%）
      const it = items[0];
      const started = !!(it && (it.operationTime || it.approveTime));
      pct = started ? 70 : 30;
      stage = started ? 'progress' : 'draft';
    } else {
      // 多个操作任务：第一个任务有操作时间/批准时间即显示正在执行中；
      // 进度按顺序完成的个数均分剩余 70%
      let donePrefix = 0;
      for (const it of items) {
        if (it.finishTime) donePrefix += 1; else break;
      }
      const first = items[0];
      const started = !!(first && (first.operationTime || first.approveTime));
      pct = 30 + (70 * donePrefix) / n;
      stage = (started || donePrefix > 0) ? 'progress' : 'draft';
    }

    pct = Math.round(pct * 10) / 10;
    if (pct >= 100) stage = 'done';
    return { pct, stage };
  }

  function renderLifecycle(todayTickets, now) {
    const el = document.getElementById('lifecycle-list');
    if (!el) return;

    const STAGES = {
      draft:   { color: '#2563eb', name: '拟票完成' },
      progress:{ color: '#f97316', name: '正在执行中' },
      done:    { color: '#16a34a', name: '已完成' },
    };
    const rows = todayTickets
      .map(t => {
        const p = lifecycleProgress(t, now);
        return { no: t.ticket_no || t.id, content: t.work_content || '', pct: p.pct, stage: p.stage };
      })
      .sort((a, b) => (a.no < b.no ? -1 : a.no > b.no ? 1 : 0));

    if (rows.length === 0) {
      el.innerHTML = '<div class="lc-empty">今日暂无可展示的指令票</div>';
      return;
    }

    el.innerHTML = `
      <table class="lc-table">
        <thead>
          <tr><th>指令票编号</th><th>工作内容</th><th>执行进度</th></tr>
        </thead>
        <tbody>
          ${rows.map(r => {
            const st = STAGES[r.stage];
            return `<tr>
              <td class="lc-no">${r.no}</td>
              <td class="lc-content" title="${r.content}">${r.content}</td>
              <td>
                <div class="lc-progress">
                  <div class="lc-bar-wrap" title="${st.name} ${r.pct}%">
                    <div class="lc-bar" style="width:${r.pct}%;background:${st.color}"></div>
                  </div>
                  <span class="lc-pct">${r.pct}%</span>
                </div>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    `;
  }

  function renderTrend({ labels, values }) {
    const chart = ensureChart('chart-trend');
    if (!chart) return;
    chart.setOption({
      tooltip: { trigger: 'axis', backgroundColor: '#fff', borderColor: '#e5e7eb', borderWidth: 1, textStyle: { color: '#1f2937', fontSize: 13 } },
      grid: { left: 40, right: 20, top: 26, bottom: 28 },
      xAxis: { type: 'category', data: labels, boundaryGap: false, axisLine: { lineStyle: { color: '#e5e7eb' } }, axisLabel: { color: '#6b7280', fontSize: 12 }, axisTick: { show: false } },
      yAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: '#f3f4f6' } }, axisLabel: { color: '#6b7280', fontSize: 12 } },
      series: [{
        type: 'line', smooth: true, symbol: 'circle', symbolSize: 6,
        lineStyle: { color: '#2563eb', width: 2.5 },
        itemStyle: { color: '#2563eb', borderColor: '#fff', borderWidth: 2 },
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(37, 99, 235, 0.3)' }, { offset: 1, color: 'rgba(37, 99, 235, 0.02)' }]) },
        data: values,
      }],
    }, true);
  }

  // 工作类型分布的两个子图标题：当日显示「X月X日」，当月显示「X年X月」
  function setWorktypeLabels(now) {
    const todayEl = document.getElementById('wt-label-today');
    const monthEl = document.getElementById('wt-label-month');
    if (todayEl) todayEl.textContent = `${now.getMonth() + 1}月${now.getDate()}日`;
    if (monthEl) monthEl.textContent = `${now.getFullYear()}年${now.getMonth() + 1}月`;
  }

  function renderWorktype(chartId, data, emptyText) {
    const chart = ensureChart(chartId);
    if (!chart) return;
    if (data.length === 0) {
      chart.clear();
      chart.setOption({
        graphic: { type: 'text', left: 'center', top: 'middle', style: { text: emptyText, fill: '#9ca3af', fontSize: 13 } }
      }, true);
      return;
    }
    const palette = ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#9333ea', '#db2777'];
    chart.setOption({
      tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)', backgroundColor: '#fff', borderColor: '#e5e7eb', borderWidth: 1, textStyle: { color: '#1f2937', fontSize: 13 } },
      legend: { type: 'scroll', bottom: 0, left: 'center', textStyle: { color: '#6b7280', fontSize: 12 }, itemWidth: 10, itemHeight: 10 },
      series: [{
        type: 'pie', radius: ['42%', '66%'], center: ['50%', '43%'],
        avoidLabelOverlap: true, itemStyle: { borderColor: '#fff', borderWidth: 2 },
        label: { show: false }, labelLine: { show: false },
        emphasis: { label: { show: true, fontSize: 14, fontWeight: 'bold', color: '#1f2937' } },
        data: data.map((d, i) => ({ ...d, itemStyle: { color: palette[i % palette.length] } })),
      }],
    }, true);
  }

  function renderAlerts(alerts) {
    const el = document.getElementById('alert-list');
    if (!el) return;
    if (alerts.length === 0) { el.className = 'alert-list ok'; el.innerHTML = '系统运行正常'; return; }
    el.className = 'alert-list';
    el.innerHTML = alerts.map(a => `
      <div class="alert-row ${a.level}">
        <span class="alert-ico">${a.level === 'danger' ? '⚠️' : '⚡'}</span>
        <span class="alert-text">${a.text}</span>
        <span class="alert-time">${a.time}</span>
      </div>
    `).join('');
  }

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { Object.values(charts).forEach(c => c && c.resize()); }, 150);
  });

  window.AppDashboard = {
    show: () => {
      Object.values(charts).forEach(c => c && c.dispose());
      charts = {};
      loadAll();
      if (refreshTimer) clearInterval(refreshTimer);
      refreshTimer = setInterval(loadAll, 30000);
    },
    hide: () => {
      if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
    },
  };
})();
