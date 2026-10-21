/* Auntie & Uncle marketplace — progressive enhancement: demo until Supabase schema is active. */
'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const BUSINESS_WHATSAPP = ''; // This demo never transmits requests. Reserved for future approved workflow.

const SAMPLE_HELPERS = Object.freeze([
  {id: 'p01', name: 'Thandi M.', initials: 'TM', service: 'Cleaning', area: 'Randburg', regions: ['Randburg', 'Johannesburg'], rate: 180, years: 6, icon: '🧹', tone: 'peach', headline: 'Thoughtful, thorough home care', bio: 'My approach is to understand the household’s routine, agree on clear priorities and leave every room feeling considered.', services: ['Regular cleaning', 'Deep cleaning', 'Laundry help'], schedule: 'Weekdays by arrangement'},
  {id: 'p02', name: 'Nomusa K.', initials: 'NK', service: 'Childcare', area: 'Soweto', regions: ['Soweto', 'Johannesburg'], rate: 220, years: 8, icon: '🧸', tone: 'lilac', headline: 'Family-focused support', bio: 'An example of a childcare introduction with a focus on routines, clear communication and agreeing responsibilities with parents. No qualifications or screening have been verified.', services: ['After-school care', 'Routine support', 'Occasional babysitting'], schedule: 'Afternoons and selected weekends'},
  {id: 'p03', name: 'Lerato S.', initials: 'LS', service: 'Cooking', area: 'Sandton', regions: ['Sandton', 'Johannesburg'], rate: 260, years: 5, icon: '🍲', tone: 'mint', headline: 'Food that feels like home', bio: 'An example home cooking listing with a focus on family meals, discussing dietary preferences and organising practical meal preparation.', services: ['Weekly meal prep', 'Home cooking', 'Small gatherings'], schedule: 'Flexible weekdays'},
  {id: 'p04', name: 'Kabelo R.', initials: 'KR', service: 'Gardening', area: 'Pretoria', regions: ['Pretoria', 'Tshwane'], rate: 160, years: 4, icon: '🌿', tone: 'sage', headline: 'Outdoor spaces, cared for', bio: 'An illustrative garden care profile offering general maintenance, trimming and a tidy outdoor space.', services: ['Garden upkeep', 'Weeding', 'Pruning'], schedule: 'Mondays to Saturdays'},
  {id: 'p05', name: 'Sipho D.', initials: 'SD', service: 'Handyman', area: 'Midrand', regions: ['Midrand', 'Johannesburg'], rate: 290, years: 10, icon: '🛠️', tone: 'peach', headline: 'Practical fixes for busy homes', bio: 'Example profile for everyday home fixes, flat-pack assembly and non-regulated maintenance. Licensed work requires independently verified credentials.', services: ['Furniture assembly', 'Minor repairs', 'Hanging fixtures'], schedule: 'By appointment'},
  {id: 'p06', name: 'Zanele P.', initials: 'ZP', service: 'Moving & rearranging', area: 'Roodepoort', regions: ['Roodepoort', 'Johannesburg'], rate: 200, years: 3, icon: '📦', tone: 'lilac', headline: 'Help for the next chapter', bio: 'An example of a helper offering careful packing assistance, furniture rearrangement and unpacking support.', services: ['Packing help', 'Unpacking', 'Room rearrangement'], schedule: 'Weekends and selected weekdays'},
  {id: 'p07', name: 'Ayanda N.', initials: 'AN', service: 'Cleaning', area: 'Johannesburg CBD', regions: ['Johannesburg', 'Braamfontein'], rate: 200, years: 7, icon: '🧽', tone: 'mint', headline: 'A fresh start, every visit', bio: 'An example cleaning provider who offers detailed home refreshes and tailored plans for smaller urban spaces.', services: ['Apartment cleaning', 'Deep cleans', 'Once-off refreshes'], schedule: 'Weekdays'},
  {id: 'p08', name: 'Themba M.', initials: 'TM', service: 'Handyman', area: 'Centurion', regions: ['Centurion', 'Pretoria', 'Tshwane'], rate: 320, years: 9, icon: '🔧', tone: 'sage', headline: 'Everyday repairs, clearly scoped', bio: 'An illustrative profile for furniture assembly and simple household maintenance with up-front scoping of materials and effort.', services: ['Furniture assembly', 'Minor maintenance', 'Shelving'], schedule: 'Selected weekdays and Saturdays'}
]);

let directoryHelpers = SAMPLE_HELPERS;
let usingLiveDirectory = false;

const menuToggle = $('#menu-toggle');
const navigation = $('#primary-nav');
menuToggle?.addEventListener('click', () => {
  const open = menuToggle.getAttribute('aria-expanded') !== 'true';
  menuToggle.setAttribute('aria-expanded', String(open));
  menuToggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  navigation.classList.toggle('open', open);
});
$$('#primary-nav a').forEach(link => link.addEventListener('click', () => {
  navigation.classList.remove('open');
  menuToggle.setAttribute('aria-expanded', 'false');
  menuToggle.setAttribute('aria-label', 'Open navigation');
}));

$$('[data-filter]').forEach(button => button.addEventListener('click', () => {
  const chosen = button.dataset.filter;
  $$('[data-filter]').forEach(item => {
    const active = item === button;
    item.classList.toggle('active', active);
    item.setAttribute('aria-pressed', String(active));
  });
  $$('[data-category]').forEach(card => {card.hidden = chosen !== 'all' && card.dataset.category !== chosen;});
}));

const categoryInput = $('#helper-category');
const areaInput = $('#helper-area');
const sortInput = $('#helper-sort');
const helperGrid = $('#helper-grid');
const emptyMarket = $('#market-empty');
const resultCount = $('#result-count');
const helperDialog = $('#helper-dialog');
const dialogContent = $('#helper-dialog-content');
const bookingService = $('#service');
const bookingArea = $('#area');
let selectedHelper = null;
let preparedMessage = '';

function el(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = String(content);
  return node;
}
function actionButton(label, action, classes) {
  const button = el('button', classes, label);
  button.type = 'button';
  button.addEventListener('click', action);
  return button;
}
function formatRand(amount) { return `R${new Intl.NumberFormat('en-ZA').format(amount)}`; }
function helperIcon(helper, large = false) {
  const avatar = el('div', `helper-avatar tone-${helper.tone}${large ? ' avatar-large' : ''}`);
  avatar.setAttribute('aria-hidden', 'true');
  avatar.append(el('span', 'avatar-symbol', helper.icon), el('small', 'avatar-initials', helper.initials));
  return avatar;
}
function renderHelpers() {
  const category = categoryInput.value;
  const query = areaInput.value.trim().toLocaleLowerCase('en-ZA');
  const sorted = directoryHelpers.filter(helper => (category === 'all' || helper.service === category) && (!query || [...helper.regions, helper.area].some(r => r.toLocaleLowerCase('en-ZA').includes(query))));
  if (sortInput.value === 'rate-low') sorted.sort((a,b) => a.rate - b.rate);
  if (sortInput.value === 'rate-high') sorted.sort((a,b) => b.rate - a.rate);
  if (sortInput.value === 'experience') sorted.sort((a,b) => b.years - a.years);
  helperGrid.replaceChildren();
  sorted.forEach(helper => {
    const card = el('article', 'helper-card');
    const header = el('div', 'helper-card-header');
    header.append(helperIcon(helper), el('span', 'sample-badge', helper.isLive ? 'APPROVED LISTING' : 'EXAMPLE PROFILE'));
    const info = el('div', 'helper-info');
    info.append(el('span', 'helper-service', helper.service), el('h3', '', helper.name), el('p', 'helper-tagline', helper.headline));
    const meta = el('div', 'helper-meta');
    meta.append(el('span', '', `📍 ${helper.area}`), el('span', '', `◷ ${helper.years} years${helper.isLive ? '' : ' (example)'}`));
    const bottom = el('div', 'helper-card-bottom');
    const rate = el('div', 'helper-rate');
    rate.append(el('strong', '', formatRand(helper.rate)), el('small', '', helper.isLive ? '/hr · indicative rate' : '/hr · sample rate'));
    bottom.append(rate, actionButton('View profile ↗', () => openHelper(helper.id), 'profile-button'));
    card.append(header, info, meta, bottom);
    helperGrid.append(card);
  });
  resultCount.textContent = `${sorted.length} ${usingLiveDirectory ? 'approved helper' : 'fictional helper'} ${sorted.length === 1 ? 'profile' : 'profiles'} shown`;
  emptyMarket.hidden = sorted.length > 0;
  helperGrid.hidden = sorted.length === 0;
}
[categoryInput, sortInput].forEach(input => input.addEventListener('change', renderHelpers));
areaInput.addEventListener('input', renderHelpers);
function resetFilters() { categoryInput.value = 'all'; areaInput.value = ''; sortInput.value = 'recommended'; renderHelpers(); }
$('#reset-search').addEventListener('click', resetFilters);
$('#empty-reset').addEventListener('click', resetFilters);
renderHelpers();

function openHelper(id) {
  const helper = directoryHelpers.find(item => item.id === id);
  if (!helper) return;
  dialogContent.replaceChildren();
  const head = el('div', 'profile-dialog-head');
  const details = el('div', 'profile-dialog-intro');
  details.append(el('p', 'helper-service', helper.service), el('h2', '', helper.name), el('p', '', helper.headline), el('p', 'profile-location', `📍 ${helper.area} · ${helper.years} years${helper.isLive ? '' : ' (illustrative)'}`));
  details.querySelector('h2').id = 'helper-dialog-title';
  head.append(helperIcon(helper, true), details);
  const bio = el('p', 'profile-bio', helper.bio);
  const listTitle = el('h3', 'profile-subhead', helper.isLive ? 'Offered services' : 'Example services');
  const list = el('ul', 'profile-skill-list');
  helper.services.forEach(item => list.append(el('li', '', item)));
  const foot = el('div', 'profile-dialog-bottom');
  const info = el('div');
  info.append(el('strong', '', `${formatRand(helper.rate)}/hr`), el('small', '', `${helper.isLive ? 'Indicative rate' : 'Sample rate'} · ${helper.schedule}`));
  foot.append(info, actionButton('Request this helper ↗', () => selectHelper(helper.id), 'button button-dark'));
  const notice = el('p', 'profile-disclaimer', helper.isLive ? 'Public listing approved by the marketplace team. Approval does not guarantee vetting, background checks, qualifications or availability.' : 'Fictional demonstration profile. No screening, credential checks, availability checks or actual provider listing is implied.');
  dialogContent.append(head, bio, listTitle, list, foot, notice);
  helperDialog.showModal();
}
$('#close-helper').addEventListener('click', () => helperDialog.close());
helperDialog.addEventListener('click', event => { if (event.target === helperDialog) helperDialog.close(); });
function selectHelper(id) {
  const helper = directoryHelpers.find(item => item.id === id);
  if (!helper) return;
  selectedHelper = helper;
  bookingService.value = helper.service;
  bookingArea.value = helper.area;
  updateSelectedHelper();
  helperDialog.close();
  $('#enquire').scrollIntoView({behavior: 'smooth', block:'start'});
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) bookingArea.focus({preventScroll: true});
}
function updateSelectedHelper() {
  $('#selected-provider').hidden = !selectedHelper;
  $('#selected-provider-name').textContent = selectedHelper ? `Requesting ${selectedHelper.name} · ${selectedHelper.service}${selectedHelper.isLive ? '' : ' (demo profile)'}` : '';
}
$('#clear-provider').addEventListener('click', () => { selectedHelper = null; updateSelectedHelper(); });
bookingService.addEventListener('change', () => {
  if (selectedHelper && bookingService.value !== selectedHelper.service) {selectedHelper = null; updateSelectedHelper();}
});
$$('[data-service]').forEach(button => button.addEventListener('click', () => {
  selectedHelper = null;
  updateSelectedHelper();
  bookingService.value = button.dataset.service;
  categoryInput.value = button.dataset.service;
  areaInput.value = '';
  sortInput.value = 'recommended';
  renderHelpers();
  $('#browse').scrollIntoView({behavior:'smooth', block:'start'});
}));

// Provider applications are previewed in memory only; nothing is saved or transmitted.
const joinForm = $('#helper-join-form');
const joinPreview = $('#join-preview');
const joinError = $('#join-error');
joinForm.addEventListener('submit', event => {
  event.preventDefault();
  joinError.hidden = true;
  const required = ['join-name','join-service','join-area','join-rate','join-bio'];
  for (const id of required) {
    const input = document.getElementById(id);
    if (id === 'join-bio' && input.value.trim().length < 10) {
      joinError.textContent = 'Please describe your service in at least 10 characters before submitting your application.';
      joinError.hidden = false;
      input.focus();
      return;
    }
    if (!input.value.trim() || !input.checkValidity()) {
      joinError.textContent = 'Complete every field using a valid value to preview your profile.';
      joinError.hidden = false;
      input.focus();
      return;
    }
  }
  const rate = Number($('#join-rate').value);
  if (!Number.isFinite(rate) || rate < 1 || rate > 100000) {joinError.textContent='Enter a valid hourly rate.'; joinError.hidden=false; $('#join-rate').focus(); return;}
  if (window.AuntieUncleLive?.operational) { window.dispatchEvent(new CustomEvent('auntie:join')); return; }
  const details = $('#join-preview-content');
  details.replaceChildren();
  details.append(el('h3', '', $('#join-name').value.trim()), el('p', 'helper-service', $('#join-service').value), el('p', '', `📍 ${$('#join-area').value.trim()}`), el('p', 'preview-rate', `${formatRand(rate)}/hr · self-proposed example rate`), el('p', '', $('#join-bio').value.trim()));
  joinForm.hidden = true;
  joinPreview.hidden = false;
  joinPreview.scrollIntoView({behavior:'smooth', block:'nearest'});
});
$('#edit-join').addEventListener('click', () => {joinPreview.hidden=true; joinForm.hidden=false; $('#join-name').focus();});
$$('#helper-join-form input, #helper-join-form select, #helper-join-form textarea').forEach(input => input.addEventListener('input', () => {joinError.hidden = true;}));

// A purely local sample dashboard: transitions intentionally do not create bookings.
const demoStatus = $('#demo-status');
function setDemoStatus(state) {
  const choices = {pending:'Pending your response',accepted:'Accepted in this demo',declined:'Declined in this demo'};
  demoStatus.textContent = choices[state];
  demoStatus.dataset.state = state;
  $('#demo-accept').disabled = state !== 'pending';
  $('#demo-decline').disabled = state !== 'pending';
}
$('#demo-accept').addEventListener('click', () => setDemoStatus('accepted'));
$('#demo-decline').addEventListener('click', () => setDemoStatus('declined'));
$('#demo-reset').addEventListener('click', () => setDemoStatus('pending'));
setDemoStatus('pending');

const enquiryForm = $('#enquiry-form');
const result = $('#request-result');
const preview = $('#request-preview');
const formError = $('#form-error');
const status = $('#copy-status');
const dateInput = $('#date');
function todayLocal() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}
dateInput.min = todayLocal();
function markInvalid(input, message) {
  formError.textContent = message;
  formError.hidden = false;
  input.setAttribute('aria-invalid','true');
  input.classList.add('invalid');
  input.focus();
}
$$('#enquiry-form input, #enquiry-form select, #enquiry-form textarea').forEach(input => input.addEventListener('input', () => {
  input.removeAttribute('aria-invalid');
  input.classList.remove('invalid');
  formError.hidden = true;
}));
function makeRequest() {
  const val = id => document.getElementById(id).value.trim();
  return [
    'AUNTIE & UNCLE — BOOKING ENQUIRY (PROTOTYPE)',
    '',
    `Example helper: ${selectedHelper ? selectedHelper.name + ' (fictional)' : 'No helper selected (open request)'}`,
    `Service: ${val('service')}`,
    `Frequency: ${val('frequency')}`,
    `Suburb / area: ${val('area')}`,
    `Preferred date: ${val('date') || 'Flexible / to be discussed'}`,
    `Preferred start time: ${val('booking-time') || 'To be discussed'}`,
    `Estimated hours: ${val('booking-hours') || 'To be discussed'}`,
    `Scope of work: ${val('details')}`,
    '',
    'Please confirm whether you can take this request and agree on the final price, scope and terms before any booking.',
    '',
    'DEMO ONLY — not transmitted, not a real booking or contact method.'
  ].join('\n');
}
enquiryForm.addEventListener('submit', event => {
  event.preventDefault();
  for (const id of ['service','area','details']) {
    const input = document.getElementById(id);
    if (!input.value.trim()) {markInvalid(input, 'Complete all required fields before preparing a request.'); return;}
  }
  if (dateInput.value && dateInput.value < todayLocal()) {markInvalid(dateInput, 'Choose today or a future date.');return;}
  const hours = $('#booking-hours');
  if (hours.value && (!hours.checkValidity() || Number(hours.value) <= 0)) {markInvalid(hours, 'Enter a valid number of hours between 1 and 24, in half-hour increments.');return;}
  if (window.AuntieUncleLive?.operational) { window.dispatchEvent(new CustomEvent('auntie:book')); return; }
  preparedMessage = makeRequest();
  preview.textContent = preparedMessage;
  enquiryForm.hidden = true;
  result.hidden = false;
  status.textContent = '';
  const whatsApp = $('#whatsapp-request');
  whatsApp.hidden = true; // No demo links to real people, even if contact info is later provided.
  whatsApp.removeAttribute('href');
  result.scrollIntoView({behavior:'smooth', block:'nearest'});
});
$('#copy-request').addEventListener('click', async () => {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Unavailable');
    await navigator.clipboard.writeText(preparedMessage);
    status.textContent = 'Copied. This is a prototype example, not a submitted booking.';
  } catch {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(preview);
    selection.removeAllRanges(); selection.addRange(range);
    status.textContent = 'Request selected. Press Ctrl+C or Cmd+C to copy.';
  }
});
$('#edit-request').addEventListener('click', () => {result.hidden = true; enquiryForm.hidden = false; bookingService.focus();});
$('#year').textContent = String(new Date().getFullYear());

// Called only after the backend successfully reads the approved-helper directory.
window.AuntieDirectory = {
  useLive(rows) { directoryHelpers = rows; usingLiveDirectory = true; selectedHelper = null; updateSelectedHelper(); renderHelpers(); },
  selected() { return selectedHelper; }
};
