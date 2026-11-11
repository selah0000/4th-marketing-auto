'use strict';
(() => {
  const byId = id => document.getElementById(id);
  const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const demo = new URLSearchParams(location.search).get('demo') === '1';
  const time = value => {
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(+date) ? date.toLocaleString('ko-KR', {timeZone:'Asia/Seoul',hour12:false}) + ' KST' : '아직 없음';
  };
  const today = () => new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const labels = {success:'원본 조회 성공',partial:'일부 제외 · 확인 필요',error:'수집 실패',pending:'연결 확인 중',collecting:'수집 중'};
  let snapshot = null, initialized = false, loading = false, requestNumber = 0, serverUnavailable = false, applicationId = '';
  const isDemo = () => demo || snapshot?.demo;
  const scope = () => globalThis.dashboardScope || {brand:'',service:''};
  function selectedSources(kind) {
    const selected = scope();
    return (snapshot?.sources || []).filter(s => s.kind === kind
      && (!selected.brand || (s.brand || '미분류') === selected.brand)
      && (kind !== 'applications' || !selected.service || s.service === selected.service));
  }
  function activeApplications() {
    return selectedSources('applications').filter(s => s.id === applicationId);
  }
  function renderApplicationSelector() {
    const sources = selectedSources('applications');
    const previous = applicationId;
    if (!sources.some(s => s.id === applicationId)) {
      applicationId = [...sources].sort((a,b) => (b.data?.dataThrough || '').localeCompare(a.data?.dataThrough || ''))[0]?.id || '';
    }
    if (applicationId !== previous) initialized = false;
    byId('application-source').innerHTML = sources.length
      ? sources.map(s => '<option value="' + safe(s.id) + '">' + safe(s.name) + (s.status === 'error' ? ' · 수집 실패' : s.status === 'partial' ? ' · 일부 날짜 제외' : '') + '</option>').join('')
      : '<option value="">연결된 신청 원본 없음</option>';
    byId('application-source').value = applicationId;
    byId('application-source').disabled = !sources.length;
  }
  function sourceLink(source) {
    if (!source.sourceUrl) return isDemo() ? '가상 원본' : '원본 링크 미설정';
    try {
      const url = new URL(source.sourceUrl);
      if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com') return '원본 주소 확인 필요';
    } catch { return '원본 주소 확인 필요'; }
    return '<a href="' + safe(source.sourceUrl) + '" target="_blank" rel="noopener noreferrer">원본 시트 열기 ↗</a>';
  }
  function applicationDates(sources = activeApplications()) {
    return [...new Set(sources.flatMap(s => (s.data?.daily || []).map(r => r.date)))].sort();
  }
  function sourceCard(source) {
    const data = source.data;
    const cached = !!data && !['success','partial'].includes(source.status);
    let recorded;
    if (source.kind === 'applications') {
      recorded = data?.dataThrough
        ? '원본 최신 응답일: <strong>' + safe(data.dataThrough) + '</strong><br>응답일 범위: ' + safe(data.dataFrom) + ' ~ ' + safe(data.dataThrough)
        : !data ? '원본 최신 응답일: 확인 불가'
        : data.invalidRows ? '원본 최신 응답일: 확인 불가 · 날짜 오류 확인 필요'
        : '원본 최신 응답일: 없음 · 수집된 원본의 유효 기록 0건';
    } else recorded = '행사 날짜는 원문 표기입니다. 원본의 최종 수정일은 확인하지 않습니다.';
    return '<article class="source-card"><strong>' + safe(source.name) + '</strong>'
      + '<span class="status ' + (['error','partial'].includes(source.status) ? 'red' : '') + '">' + safe(labels[source.status] || '상태 확인 필요') + '</span>'
      + '<small>마지막 성공 시각: ' + safe(time(source.lastSuccessAt)) + '<br>최근 시도 시각: ' + safe(time(source.lastAttemptAt)) + '</small>'
      + '<p class="sub">' + recorded + '</p>'
      + (source.kind === 'applications' ? '<small>조회 성공 시각과 실제 응답이 기록된 날짜는 다릅니다.</small>' : '')
      + '<p class="sub">' + sourceLink(source) + '</p>'
      + (source.error ? '<p class="error">' + safe(source.error) + '</p>' : '')
      + (cached ? '<p class="error">마지막 성공 결과를 보관 중입니다. 현재 원본의 최신 결과로 확정하지 않습니다.</p>' : '')
      + (!data && source.status === 'error' ? '<p class="error">확인된 값이 없어 0으로 표시하지 않습니다.</p>' : '')
      + '</article>';
  }
  function render() {
    if (!snapshot) return;
    const allSources = snapshot.sources || [];
    globalThis.updateScopeOptions?.(allSources.filter(s => s.kind === 'seminars').flatMap(s => (s.data?.rows || []).map(r => ({...r,brand:r.brand || s.brand || '미분류'}))));
    const selected = scope();
    const sources = allSources.filter(s => !selected.brand || (s.brand || '미분류') === selected.brand);
    if(!globalThis.mutoActive) byId('mode').textContent = isDemo() ? '공유용 가상 데이터' : '실제 시트 · 로컬 전용';
    byId('live-badge').textContent = isDemo() ? '제출 캡처용 · 모든 숫자는 가상' : '원본 자동 수집 · 5분 간격';
    byId('live-notice').textContent = isDemo()
      ? '이 화면에는 실제 숫자·원본 주소가 포함되지 않습니다. 가상 샘플은 작동 검증용 실데이터와 분리되어 있습니다.'
      : '이 Mac에서 서버가 실행 중일 때 5분마다 원본을 다시 읽습니다. 조회 성공은 오늘 신청이 발생했다는 뜻이 아닙니다. 아래 원본 최신 응답일을 함께 확인하세요.';
    byId('source-status').innerHTML = sources.length ? sources.map(sourceCard).join('')
      : '<p>연결 준비 중: 선택한 브랜드의 원본 설정이 없습니다. 실제 0건이나 수집 실패와 다릅니다.</p>';
    byId('storage-error').textContent = snapshot.storageError || '';
    renderApplicationSelector();
    if (!initialized && activeApplications().some(s => s.data)) {
      const dates = applicationDates(), end = dates.at(-1) || today();
      byId('live-start').value = dates.length ? end.slice(0,4) + '-01-01' : end;
      byId('live-end').value = end;
      initialized = true;
    }
    renderDaily();
    renderSeminars();
  }
  function renderDaily() {
    if (!snapshot) return;
    const selected = activeApplications();
    const available = selected.filter(s => s.data);
    const start = byId('live-start').value, end = byId('live-end').value;
    byId('live-filter-error').textContent = '';
    if (!available.length) {
      const state = selected.some(s => s.status === 'error') ? 'error' : selected.length ? 'pending' : 'unconnected';
      const message = state === 'error'
        ? '수집 실패: 선택한 신청 원본에서 확인된 결과가 없습니다. 오류를 해결하기 전에는 0건으로 판단하지 않습니다.'
        : state === 'pending' ? '연결 확인 중: 아직 성공한 수집 결과가 없습니다. 0건으로 판단하지 않습니다.'
        : '연결 전: 선택한 브랜드·서비스에 연결된 신청 원본이 없습니다. 실제 0건을 뜻하지 않습니다.';
      byId('daily-results').innerHTML = '<p data-state="' + state + '" role="status">' + message + '</p>';
      return;
    }
    if (!start || !end || start > end) {
      byId('live-filter-error').textContent = '시작일과 종료일을 확인해주세요. 시작일은 종료일보다 늦을 수 없습니다.';
      byId('daily-results').innerHTML = '';
      return;
    }
    const counts = new Map();
    for (const source of available) for (const row of source.data.daily || []) {
      if (row.date >= start && row.date <= end) counts.set(row.date, (counts.get(row.date) || 0) + row.applications);
    }
    const rows = [...counts].sort(([a],[b]) => a.localeCompare(b)).map(([date,applications]) => ({date,applications}));
    const total = rows.reduce((sum,row) => sum + row.applications, 0);
    const invalidRows = available.reduce((sum,s) => sum + (s.data.invalidRows || 0), 0);
    const missing = selected.length - available.length;
    const cached = serverUnavailable || available.some(s => !['success','partial'].includes(s.status));
    const incomplete = missing > 0 || invalidRows > 0;
    const unknownZero = incomplete && total === 0;
    const state = serverUnavailable ? 'offline-cache' : cached ? 'cached' : incomplete ? 'partial' : total === 0 ? 'confirmed-zero' : 'success';
    const latest = applicationDates().at(-1);
    byId('daily-results').innerHTML = '<div data-state="' + state + '">'
      + (cached ? '<p class="error">최신 수집이 확인되지 않아 마지막 성공 시점의 기록을 보여줍니다.</p>' : '')
      + (missing ? '<p class="error">선택한 신청 원본 ' + selected.length + '개 중 ' + missing + '개는 성공 결과가 없어 합계에서 제외했습니다. 전체 합계로 판단하지 않습니다.</p>' : '')
      + '<p class="sub">집계 범위: ' + available.map(s => safe(s.name)).join(' · ') + '<br>선택한 원본의 날짜 기록만 집계합니다. 원본 사이의 중복 여부를 확인할 수 없어 서로 합산하지 않습니다. 고유 신청자 수가 아닙니다.'
      + available.map(s => s.scopeNote ? '<br>' + safe(s.scopeNote) : '').join('')
      + (latest ? '<br>원본 최신 응답일: <strong>' + safe(latest) + '</strong> · 조회 성공 시각과 구분' : '<br>원본에 유효한 응답 날짜가 없습니다.') + '</p>'
      + '<div class="kpis"><div class="kpi"><span>' + (incomplete ? '확인된 신청 기록 · 일부 결과' : '선택 기간 신청 기록') + '</span><b>' + (unknownZero ? '—' : total.toLocaleString('ko-KR')) + '</b><small>' + (unknownZero ? '누락·날짜 오류로 0건 확정 불가' : '응답 행 수 · 고유 신청자 수 아님') + '</small></div>'
      + '<div class="kpi"><span>기록이 있는 날짜</span><b>' + (unknownZero ? '—' : rows.length) + '</b><small>' + safe(start) + ' ~ ' + safe(end) + '</small></div>'
      + '<div class="kpi"><span>상담 / 결제 / 매출</span><b>—</b><small>연결 준비 중 · 실제 0과 구분</small></div>'
      + '<div class="kpi"><span>광고 · 블로그 · 카페 지표</span><b>—</b><small>채널별 성과 수집은 연결 준비 중</small></div></div>'
      + (invalidRows ? '<p class="error">날짜를 해석하지 못한 ' + invalidRows + '행은 집계에서 제외됐습니다. 이 합계는 불완전하며 해당 행이 선택 기간에 속하는지도 확인할 수 없습니다.</p>' : '')
      + (rows.length ? '<div class="tablewrap"><table style="min-width:360px"><thead><tr><th>신청 응답일 (한국 시간)</th><th>신청 기록 수</th></tr></thead><tbody>'
        + rows.map(row => '<tr><td>' + safe(row.date) + '</td><td>' + row.applications.toLocaleString('ko-KR') + '</td></tr>').join('') + '</tbody></table></div>'
        : '<p>' + (unknownZero ? '확인 가능한 날짜별 기록이 없습니다. 누락 또는 오류 때문에 0건으로 확정하지 않습니다.' : '선택한 기간에 저장된 신청 기록이 없습니다. 이는 이 시트에서 확인된 기록 기준이며 전체 사업의 신청 0건을 뜻하지 않습니다.') + '</p>')
      + '</div>';
  }
  function renderSeminars() {
    if (!snapshot) return;
    const selected = selectedSources('seminars'), available = selected.filter(s => s.data);
    if (!available.length) {
      byId('seminar-results').innerHTML = '<p>' + (selected.some(s => s.status === 'error') ? '행사별 결산 수집 실패: 확인된 결과가 없습니다.' : selected.length ? '행사별 결산 연결 확인 중: 아직 성공 결과가 없습니다.' : '선택한 브랜드의 행사별 결산은 연결 전입니다.') + ' 0개 행사로 판단하지 않습니다.</p>';
      return;
    }
    const query = byId('seminar-search').value.trim().toLowerCase(), selectedScope = scope();
    const rows = available.flatMap(s => (s.data.rows || []).map(r => ({...r,brand:r.brand || s.brand || '미분류'})))
      .filter(r => (!selectedScope.brand || r.brand === selectedScope.brand) && (!selectedScope.service || r.name === selectedScope.service) && (r.name + ' ' + r.channel).toLowerCase().includes(query));
    const cached = serverUnavailable || available.some(s => !['success','partial'].includes(s.status));
    const incomplete = available.length < selected.length || available.some(s => s.data.invalidRows > 0);
    const value = x => x === null || x === undefined || x === '' ? '미기록' : x;
    byId('seminar-results').innerHTML = (cached ? '<p class="error">마지막 성공 결과입니다. 최신 수집은 확인되지 않았습니다.</p>' : '')
      + (incomplete ? '<p class="error">일부 원본 또는 행이 제외된 결과입니다. 전체 행사 수로 확정하지 않습니다.</p>' : '')
      + '<p>' + rows.length + '개 행사 · 검색·선택 조건에 맞는 확인된 기록</p>'
      + (rows.length ? '<table><thead><tr>' + ['브랜드','일시(원문)','세미나','모객 방법','신청 기록','참여 기록','유료 전환 기록','원본 전환율'].map(x => '<th>' + x + '</th>').join('') + '</tr></thead><tbody>'
        + rows.map(r => '<tr>' + [r.brand,r.date,r.name,r.channel,r.applications,r.attendance,r.conversion,r.rate].map(x => '<td style="white-space:pre-wrap;min-width:100px;max-width:280px;vertical-align:top">' + safe(value(x)) + '</td>').join('') + '</tr>').join('') + '</tbody></table>'
        : '<p>검색 결과가 없습니다. 검색어나 브랜드·서비스 선택을 확인해주세요.</p>');
  }
  async function load(manual = false) {
    if (loading) return;
    loading = true;
    const request = ++requestNumber;
    byId('refresh-live').disabled = true;
    byId('refresh-live').textContent = manual ? '원본 확인 중…' : '불러오는 중…';
    try {
      const useDemo = isDemo();
      const endpoint = useDemo ? '/api/demo' : manual ? '/api/refresh' : '/api/dashboard';
      const response = await fetch("/demo.json", {cache:'no-store',signal:AbortSignal.timeout(30000),...(manual && !useDemo ? {method:'POST',headers:{'X-Dashboard-Refresh':'1'}} : {})});
      if (!response.ok) throw Error('HTTP ' + response.status);
      const data = await response.json();
      if (!Array.isArray(data.sources)) throw Error('Invalid response');
      if (request !== requestNumber) return;
      snapshot = data;
      serverUnavailable = false;
      byId('live-fetch-error').textContent = '';
      render();
    } catch {
      serverUnavailable = true;
      byId('live-fetch-error').textContent = '로컬 서버에 연결하지 못했습니다. 서버가 실행 중인지 확인해주세요. 기존 결과는 유지하며 0으로 바꾸지 않습니다.';
      if (snapshot) render();
      else byId('daily-results').innerHTML = '<p data-state="server-error" role="status">서버 연결 실패: 확인된 결과가 없습니다. 신청 0건을 뜻하지 않습니다.</p>';
    } finally {
      if (request === requestNumber) {
        loading = false;
        byId('refresh-live').disabled = false;
        byId('refresh-live').textContent = isDemo() ? '가상 예시 다시 보기' : '지금 새로고침';
      }
    }
  }
  ['live-start','live-end'].forEach(id => byId(id).addEventListener('input',renderDaily));
  byId('all-live-dates').onclick = () => {
    const dates = applicationDates();
    if (dates.length) {
      byId('live-start').value = dates[0];
      byId('live-end').value = dates.at(-1);
    }
    renderDaily();
  };
  byId('application-source').onchange = () => { applicationId = byId('application-source').value; initialized = false; render(); };
  byId('seminar-search').addEventListener('input',renderSeminars);
  byId('refresh-live').onclick = () => load(true);
  globalThis.addEventListener?.('dashboard-scope',render);
  void load();
  setInterval(() => { if (!document.hidden) void load(); },15000);
  document.addEventListener('visibilitychange',() => { if (!document.hidden) void load(); });
})();
