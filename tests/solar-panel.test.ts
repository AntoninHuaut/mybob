import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { readFile } from 'node:fs/promises';
import { Window, HTMLFormElement as DOMForm, HTMLInputElement as DOMInput } from 'happy-dom';
import type { HouseProject, SolarSettings } from '../src/model/types';
import { validateProject } from '../src/model/validate';

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
    return nextLoad(url, context);
  },
});
const { SolarPanel } = await import('../src/ui/solarPanel');
const fixture: HouseProject = JSON.parse(
  await readFile(new URL('../public/projects/studio-demo.json', import.meta.url), 'utf8'),
);
const location: SolarSettings = {
  latitude: 48.8566,
  longitude: 2.3522,
  northAngleDeg: 90,
  timeZone: 'Europe/Paris',
  label: 'Paris',
};
const preferenceKey = (id: string) => `maison-atelier:solar:${id}`;

function setup() {
  const window = new Window({ url: 'http://localhost' });
  const names = ['document', 'HTMLElement', 'localStorage', 'fetch'] as const;
  const saved = new Map(
    names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  for (const name of ['document', 'HTMLElement', 'localStorage'] as const)
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value: window[name],
    });
  const requests: string[] = [];
  let response: unknown = { results: [] };
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: async (url: string | URL | Request) => {
      requests.push(String(url));
      return new Response(JSON.stringify(response), { status: 200 });
    },
  });
  const applications: { settings: SolarSettings | undefined; instant: Date }[] = [];
  const dialogStates: boolean[] = [];
  const panel = new SolarPanel({
    onApply: (settings, instant) => applications.push({ settings, instant }),
    onDialogState: (open) => dialogStates.push(open),
  });
  const input = (name: string, value?: string) => {
    const control = panel.dialog.querySelector(`[name=${name}]`) as unknown as DOMInput;
    assert.ok(control, `missing ${name}`);
    if (value !== undefined) control.value = value;
    return control;
  };
  const click = (selector: string) => {
    const element = panel.dialog.querySelector(selector)!;
    assert.ok(element, `missing ${selector}`);
    element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }) as unknown as Event);
  };
  const submit = () => {
    const form = panel.dialog.querySelector('form') as unknown as DOMForm;
    // happy-dom's floating step emulation is unrelated to geographic validation.
    form.reportValidity = () => true;
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  };
  const fillValid = () => {
    input('latitude', String(location.latitude));
    input('longitude', String(location.longitude));
    input('northAngleDeg', '90');
    input('timeZone', 'Europe/Paris');
    input('city', 'Paris');
    input('date', '2026-07-01');
    input('time', '12:30');
  };
  return {
    window,
    panel,
    input,
    click,
    submit,
    fillValid,
    requests,
    applications,
    dialogStates,
    respondWith: (next: unknown) => {
      response = next;
    },
    cleanup() {
      panel.dialog.remove();
      window.close();
      for (const name of names) {
        const prior = saved.get(name);
        if (prior) Object.defineProperty(globalThis, name, prior);
        else Reflect.deleteProperty(globalThis, name);
      }
    },
  };
}
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

test('solar panel never infers a location or contacts a service on load or open', () => {
  const ctx = setup();
  try {
    const project = { ...structuredClone(fixture), id: 'no-location' };
    delete project.solar;
    ctx.panel.load(project);
    assert.equal(ctx.panel.settings, undefined);
    assert.equal(ctx.applications.length, 1);
    assert.equal(ctx.applications[0].settings, undefined);
    ctx.panel.open();
    assert.equal(ctx.input('latitude').value, '');
    assert.equal(ctx.input('longitude').value, '');
    assert.equal(ctx.input('city').value, '');
    assert.equal(ctx.requests.length, 0);
    assert.equal(ctx.window.localStorage.length, 0);
  } finally {
    ctx.cleanup();
  }
});

test('solar preferences restore independently for each project and never mutate the imported data', () => {
  const ctx = setup();
  try {
    const a = { ...structuredClone(fixture), id: 'house-a', solar: { ...location } };
    const b = { ...structuredClone(fixture), id: 'house-b' };
    delete b.solar;
    const saved = {
      ...location,
      latitude: 43.6,
      longitude: 1.44,
      label: 'Toulouse',
      northAngleDeg: 270,
    };
    ctx.window.localStorage.setItem(preferenceKey(a.id), JSON.stringify(saved));
    ctx.panel.load(a);
    assert.deepEqual(ctx.panel.settings, saved);
    assert.deepEqual(a.solar, location);
    ctx.panel.load(b);
    assert.equal(ctx.panel.settings, undefined);
    ctx.panel.load(a);
    assert.deepEqual(ctx.panel.settings, saved);
    const returned = ctx.panel.settings as SolarSettings;
    returned.latitude = 0;
    assert.equal((ctx.panel.settings as SolarSettings).latitude, saved.latitude);
    assert.equal(ctx.requests.length, 0);
  } finally {
    ctx.cleanup();
  }
});

test('Apply persists explicit coordinates and converts the local date using the selected IANA timezone', async () => {
  const ctx = setup();
  try {
    const project = { ...structuredClone(fixture), id: 'apply-house' };
    ctx.panel.load(project);
    ctx.panel.open();
    ctx.fillValid();
    ctx.submit();
    await turn();
    assert.deepEqual(ctx.panel.settings, { ...location, instant: '2026-07-01T10:30:00.000Z' });
    assert.deepEqual(JSON.parse(ctx.window.localStorage.getItem(preferenceKey(project.id))!), {
      ...location,
      instant: '2026-07-01T10:30:00.000Z',
    });
    assert.equal(ctx.applications.at(-1)!.instant.toISOString(), '2026-07-01T10:30:00.000Z');
    assert.equal(ctx.panel.dialog.open, false);
    assert.equal(ctx.dialogStates.at(-1), false);
    assert.equal(ctx.requests.length, 0);
  } finally {
    ctx.cleanup();
  }
});

test('solar instant survives reload/export and stays independent for each project', () => {
  const ctx = setup();
  try {
    const a = { ...structuredClone(fixture), id: 'instant-a' };
    ctx.panel.load(a);
    ctx.panel.open();
    ctx.fillValid();
    ctx.submit();
    const exported = validateProject(
      JSON.parse(JSON.stringify({ ...a, solar: ctx.panel.settings })),
    );
    const b = {
      ...structuredClone(fixture),
      id: 'instant-b',
      solar: { ...location, instant: '2026-01-01T17:00:00.000Z' },
    };
    const restored = new SolarPanel({
      onApply: (settings, instant) => ctx.applications.push({ settings, instant }),
      onDialogState: () => {},
    });
    restored.load(b);
    assert.equal(ctx.applications.at(-1)!.instant.toISOString(), b.solar.instant);
    restored.load(a);
    assert.equal(ctx.applications.at(-1)!.instant.toISOString(), exported.solar!.instant);
    restored.open();
    assert.equal(
      restored.dialog.querySelector<HTMLInputElement>('[name=date]')!.value,
      '2026-07-01',
    );
    assert.equal(restored.dialog.querySelector<HTMLInputElement>('[name=time]')!.value, '12:30');
    restored.dialog.remove();
    ctx.window.localStorage.clear();
    restored.load(exported);
    assert.equal(ctx.applications.at(-1)!.instant.toISOString(), exported.solar!.instant);
    restored.load({ ...a, id: 'legacy-solar', solar: { ...location } });
    assert.ok(Math.abs(ctx.applications.at(-1)!.instant.getTime() - Date.now()) < 5000);
  } finally {
    ctx.cleanup();
  }
});

test('editing a town clears stale coordinates and Enter searches instead of applying', async () => {
  const ctx = setup();
  try {
    ctx.panel.load({ ...structuredClone(fixture), solar: { ...location } });
    ctx.panel.open();
    const before = ctx.applications.length;
    ctx.input('city', 'Toulouse').dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
    assert.equal(ctx.input('latitude').value, '');
    assert.equal(ctx.input('longitude').value, '');
    assert.equal(ctx.panel.dialog.querySelector('details')!.open, true);
    ctx.respondWith({
      results: [{ name: 'Toulouse', latitude: 43.6, longitude: 1.44, timezone: 'Europe/Paris' }],
    });
    const enter = new ctx.window.KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    ctx.input('city').dispatchEvent(enter);
    await turn();
    assert.equal(enter.defaultPrevented, true);
    assert.equal(ctx.requests.length, 1);
    assert.equal(ctx.applications.length, before);
    assert.equal(ctx.panel.dialog.open, true);
    ctx.click('[data-solar-result="0"]');
    assert.equal(ctx.input('latitude').value, '43.6');
    assert.equal(ctx.input('longitude').value, '1.44');
  } finally {
    ctx.cleanup();
  }
});

test('Cancel discards edited location and date without applying or persisting anything', async () => {
  const ctx = setup();
  try {
    const project = { ...structuredClone(fixture), id: 'cancel-house', solar: { ...location } };
    ctx.panel.load(project);
    const before = ctx.applications.length;
    ctx.panel.open();
    ctx.fillValid();
    ctx.input('latitude', '0');
    ctx.input('city', 'Brouillon');
    ctx.click('footer [data-solar-close]');
    await turn();
    assert.equal(ctx.applications.length, before);
    assert.deepEqual(ctx.panel.settings, location);
    assert.equal(ctx.window.localStorage.getItem(preferenceKey(project.id)), null);
    assert.equal(ctx.panel.dialog.open, false);
    ctx.panel.open();
    assert.equal(ctx.input('city').value, 'Paris');
    assert.equal(ctx.input('latitude').value, String(location.latitude));
  } finally {
    ctx.cleanup();
  }
});

test('neutral lighting persists an explicit null preference that overrides imported solar settings on reload', () => {
  const ctx = setup();
  try {
    const project = { ...structuredClone(fixture), id: 'reset-house', solar: { ...location } };
    ctx.panel.load(project);
    ctx.panel.open();
    ctx.click('[data-solar-reset]');
    assert.equal(ctx.window.localStorage.getItem(preferenceKey(project.id)), 'null');
    assert.equal(ctx.panel.settings, undefined);
    assert.equal(ctx.applications.at(-1)!.settings, undefined);
    ctx.panel.load(project);
    assert.equal(ctx.panel.settings, undefined);
    assert.deepEqual(project.solar, location);
  } finally {
    ctx.cleanup();
  }
});

test('town lookup requires an explicit click, sends only town text, escapes results and selects coordinates with timezone', async () => {
  const ctx = setup();
  try {
    const project = {
      ...structuredClone(fixture),
      id: 'private-house-name',
      solar: { ...location },
    };
    ctx.panel.load(project);
    ctx.panel.open();
    ctx.respondWith({
      results: [
        {
          name: '<img src=x onerror=alert(1)>',
          admin1: 'Région',
          country: 'France',
          latitude: 43.6,
          longitude: 1.44,
          timezone: 'Europe/Paris',
        },
      ],
    });
    ctx.input('city', 'Toulouse');
    ctx.input('city').dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
    await turn();
    assert.equal(ctx.requests.length, 0);
    ctx.click('[data-solar-search]');
    await turn();
    assert.equal(ctx.requests.length, 1);
    const url = new URL(ctx.requests[0]);
    assert.equal(url.origin, 'https://geocoding-api.open-meteo.com');
    assert.deepEqual([...url.searchParams.keys()].sort(), ['count', 'format', 'language', 'name']);
    assert.equal(url.searchParams.get('name'), 'Toulouse');
    assert.ok(!ctx.requests[0].includes(project.id));
    assert.ok(!ctx.requests[0].includes(String(location.latitude)));
    const results = ctx.panel.dialog.querySelector('[data-solar-results]')!;
    assert.equal(results.querySelector('img'), null);
    assert.match(results.textContent!, /<img src=x onerror=alert\(1\)>/);
    const before = ctx.applications.length;
    ctx.click('[data-solar-result="0"]');
    assert.equal(ctx.input('latitude').value, '43.6');
    assert.equal(ctx.input('longitude').value, '1.44');
    assert.equal(ctx.input('timeZone').value, 'Europe/Paris');
    assert.equal(ctx.applications.length, before);
    assert.equal(ctx.window.localStorage.length, 0);
  } finally {
    ctx.cleanup();
  }
});

test('local storage failure keeps the modal open and reports the error without applying settings', () => {
  const ctx = setup();
  try {
    ctx.panel.load({ ...structuredClone(fixture), id: 'quota-house' });
    ctx.panel.open();
    ctx.fillValid();
    const before = ctx.applications.length;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        setItem() {
          throw new Error('Quota local dépassé');
        },
      },
    });
    ctx.submit();
    assert.equal(ctx.panel.dialog.open, true);
    assert.equal(ctx.applications.length, before);
    assert.match(
      ctx.panel.dialog.querySelector('[data-solar-status]')!.textContent!,
      /Quota local dépassé/,
    );
    ctx.click('[data-solar-reset]');
    assert.equal(ctx.panel.dialog.open, true);
    assert.equal(ctx.applications.length, before);
    assert.match(
      ctx.panel.dialog.querySelector('[data-solar-status]')!.textContent!,
      /Sauvegarde locale indisponible/,
    );
  } finally {
    ctx.cleanup();
  }
});

test('a delayed town result cannot populate a reopened dialog after its search was cancelled', async () => {
  const ctx = setup();
  try {
    let resolveResults!: (value: unknown) => void;
    const delayed = new Promise<unknown>((resolve) => {
      resolveResults = resolve;
    });
    globalThis.fetch = (async () => ({ ok: true, json: () => delayed })) as unknown as typeof fetch;
    ctx.panel.load({ ...structuredClone(fixture), id: 'late-search' });
    ctx.panel.open();
    ctx.input('city', 'Ancienne commune');
    ctx.click('[data-solar-search]');
    await turn();
    ctx.click('footer [data-solar-close]');
    await turn();
    ctx.panel.open();
    ctx.input('city', 'Nouvelle commune');
    resolveResults({
      results: [{ name: 'Ancien résultat', latitude: 1, longitude: 2, timezone: 'UTC' }],
    });
    await turn();
    assert.equal(ctx.input('city').value, 'Nouvelle commune');
    assert.equal(ctx.panel.dialog.querySelector('[data-solar-result]'), null);
    assert.equal(ctx.panel.dialog.querySelector('[data-solar-status]')!.textContent, '');
  } finally {
    ctx.cleanup();
  }
});

test('scene timeline stays hidden without an explicit location and tracks real DST instants', () => {
  const ctx = setup();
  try {
    const host = document.createElement('div');
    document.body.append(host);
    ctx.panel.mountTimeline(host);
    ctx.panel.load({ ...structuredClone(fixture), id: 'no-timeline-location' });
    assert.equal(host.querySelector<HTMLDetailsElement>('.solar-timeline')!.hidden, true);
    assert.equal(ctx.requests.length, 0);
    const project = {
      ...structuredClone(fixture),
      id: 'timeline-dst',
      solar: { ...location, instant: '2026-03-29T00:30:00.000Z' },
    };
    ctx.panel.load(project);
    const slider = host.querySelector<HTMLInputElement>('[data-solar-timeline-slider]')!;
    assert.equal(host.querySelector<HTMLDetailsElement>('.solar-timeline')!.hidden, false);
    assert.equal(slider.max, '1379');
    slider.value = '150';
    slider.dispatchEvent(new ctx.window.Event('input', { bubbles: true }) as unknown as Event);
    assert.equal(ctx.applications.at(-1)!.instant.toISOString(), '2026-03-29T01:30:00.000Z');
    assert.match(slider.getAttribute('aria-valuetext')!, /03:30/);
    assert.equal(host.querySelector('[data-solar-timeline-slider]'), slider);
    assert.equal(
      JSON.parse(ctx.window.localStorage.getItem(preferenceKey(project.id))!).instant,
      '2026-03-29T01:30:00.000Z',
    );
    assert.equal(ctx.panel.dialog.open, false);
    assert.deepEqual(ctx.dialogStates, []);
    ctx.panel.load({
      ...project,
      id: 'timeline-repeat',
      solar: { ...location, instant: '2026-10-24T23:30:00.000Z' },
    });
    assert.equal(slider.max, '1499');
    slider.value = '150';
    slider.dispatchEvent(new ctx.window.Event('input', { bubbles: true }) as unknown as Event);
    const firstOccurrence = slider.getAttribute('aria-valuetext');
    assert.equal(ctx.applications.at(-1)!.instant.toISOString(), '2026-10-25T00:30:00.000Z');
    slider.value = '210';
    slider.dispatchEvent(new ctx.window.Event('input', { bubbles: true }) as unknown as Event);
    const secondOccurrence = slider.getAttribute('aria-valuetext');
    assert.equal(ctx.applications.at(-1)!.instant.toISOString(), '2026-10-25T01:30:00.000Z');
    assert.match(firstOccurrence!, /02:30/);
    assert.match(secondOccurrence!, /02:30/);
    assert.notEqual(firstOccurrence, secondOccurrence);
  } finally {
    ctx.cleanup();
  }
});

test('season shortcuts preserve local clock time and use the configured hemisphere', () => {
  const ctx = setup();
  try {
    const host = document.createElement('div');
    document.body.append(host);
    ctx.panel.mountTimeline(host);
    const project = {
      ...structuredClone(fixture),
      id: 'timeline-seasons',
      solar: { ...location, instant: '2026-07-01T10:30:00.000Z' },
    };
    ctx.panel.load(project);
    const clickSeason = (season: string) =>
      host.querySelector<HTMLButtonElement>(`[data-solar-season=${season}]`)!.click();
    clickSeason('winter');
    assert.equal(ctx.applications.at(-1)!.instant.toISOString(), '2026-12-21T11:30:00.000Z');
    clickSeason('summer');
    assert.equal(ctx.applications.at(-1)!.instant.toISOString(), '2026-06-21T10:30:00.000Z');
    ctx.panel.load({
      ...project,
      id: 'south-seasons',
      solar: { ...project.solar, latitude: -33.9, longitude: 151.2, timeZone: 'Australia/Sydney' },
    });
    clickSeason('summer');
    assert.equal(
      host.querySelector<HTMLInputElement>('[data-solar-timeline-date]')!.value,
      '2026-12-21',
    );
    const original = ctx.panel.settings;
    ctx.panel.open();
    ctx.input('latitude', '0');
    ctx.click('footer [data-solar-close]');
    assert.deepEqual(ctx.panel.settings, original);
  } finally {
    ctx.cleanup();
  }
});

test('timeline reports storage failures without applying an unsaved instant', () => {
  const ctx = setup();
  try {
    const host = document.createElement('div');
    document.body.append(host);
    ctx.panel.mountTimeline(host);
    ctx.panel.load({
      ...structuredClone(fixture),
      solar: { ...location, instant: '2026-07-01T10:30:00.000Z' },
    });
    const before = ctx.applications.length;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        setItem() {
          throw new Error('Quota local dépassé');
        },
      },
    });
    const slider = host.querySelector<HTMLInputElement>('[data-solar-timeline-slider]')!;
    const oldValue = slider.value;
    slider.value = '100';
    slider.dispatchEvent(new ctx.window.Event('input', { bubbles: true }) as unknown as Event);
    assert.equal(ctx.applications.length, before);
    assert.equal(slider.value, oldValue);
    assert.match(host.querySelector('[data-solar-timeline-status]')!.textContent!, /Quota/);
  } finally {
    ctx.cleanup();
  }
});
