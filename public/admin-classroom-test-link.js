'use strict';
// The entry point is rendered only after live DB-backed admin authorization.
// Hiding this link is NOT the security boundary; the gateway verifies every request.
(async()=>{
  const api=window.KIWI_API_CLIENT;
  if(!api?.hasKiwiSession?.()||typeof api.kiwiApiRequest!=='function')return;
  try{
    const access=await api.kiwiApiRequest('/teaching/admin/classroom-test/access');
    if(access?.admin!==true)return;
    const footer=document.querySelector('#teachingMenuPanel .teaching-menu-panel__footer');
    if(!footer||footer.querySelector('[data-admin-classroom-test]'))return;
    const link=document.createElement('a');
    link.href='/admin-classroom-test.html';
    link.className='teaching-menu-action';
    link.dataset.adminClassroomTest='true';
    link.style.textDecoration='none';
    link.style.display='flex';
    link.style.alignItems='center';
    link.style.gap='12px';
    const icon=document.createElement('span');
    icon.textContent='◈';
    icon.setAttribute('aria-hidden','true');
    icon.style.fontSize='1.35rem';
    const text=document.createElement('span');text.textContent='Test Classroom';
    const meta=document.createElement('span');
    meta.className='teaching-menu-action__meta';meta.textContent='Admin only';
    link.append(icon,text,meta);
    footer.prepend(link);
  }catch(_){/* non-admin or disconnected: do not show an entry point */}
})();
