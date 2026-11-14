const assert = require('node:assert/strict');

module.exports = async function requiredIncludes(browser, base) {
  const selected=await browser.newPage();
  const requested=[];
  await selected.route('**/selection/**',route=>{
    const name=new URL(route.request().url()).pathname.split('/').pop();requested.push(name);
    return route.fulfill({body:name==='slots'?'<slot><cf-include src="/selection/unused-slot"></cf-include></slot>':'<b>Selected</b>'});
  });
  await selected.route(base + 'selection.html', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Selection fixture</title><script defer src="/cfjs.js"></script><body></body>'
  }));
  await selected.goto(base + 'selection.html');
  await selected.waitForFunction(()=>!document.querySelector('cf-include'));
  await selected.evaluate(()=>{
    window.selectedData={yes:true,empty:[],rows:[{},{}],label:'Replacement'};
    const host=document.createElement('cf-data');host.id='selected';host.setAttribute('source','selectedData');host.setAttribute('name','data');
    host.innerHTML=`<template>
      <cf-if test="data.yes"><template><cf-include src="/selection/chosen"></cf-include></template><template data-state="else"><cf-include src="/selection/unused-condition"></cf-include></template></cf-if>
      <cf-loop items="data.empty" as="item"><template><cf-include src="/selection/unused-row"></cf-include></template></cf-loop>
      <cf-loop items="data.rows" as="item"><template><cf-include src="/selection/chosen"></cf-include></template></cf-loop>
      <p cf-text="data.label"><cf-include src="/selection/replaced"></cf-include></p>
      <cf-include src="/selection/slots"><b>Assigned</b></cf-include>
      <cf-include src="/selection/no-slot"><cf-include src="/selection/discarded-child"></cf-include></cf-include>
      <template><cf-include src="/selection/inert"></cf-include></template>
    </template>`;
    host.addEventListener('cf:load',()=>window.selectedDone=true);document.body.append(host);
  });
  await selected.waitForFunction(()=>window.selectedDone);
  assert.deepEqual(requested.sort(),['chosen','no-slot','slots']);
  await selected.close();
  console.log('PASS: required includes only, selected conditions/rows/slots, discarded children and request deduplication');
};
