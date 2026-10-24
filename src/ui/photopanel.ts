/* ============================================================
   The photo mode panel: lens, exposure, depth of field, a look,
   and a preview of another hour or other weather; H hides it for
   a clean view, Enter saves the shot. Sliders hand the keyboard
   back as soon as they're let go, so WASD keeps flying.
   ============================================================ */
import { LOOKS, PhotoMode, WeatherPreview, focalLength } from '../player/photo';

const $ = (id: string) => document.getElementById(id)!;
const WEATHER: [WeatherPreview | null, string][] = [[null, 'As it is'], ['clear', 'Clear'], ['clouds', 'Cloudy'], ['rain', 'Rain'], ['heavy', 'Storm'], ['snow', 'Snow']];
/** the focus slider runs 0.5 m … 500 m on a log scale */
const toFocus = (t: number): number => 0.5 * Math.pow(1000, t);
const fromFocus = (m: number): number => Math.log(m / 0.5) / Math.log(1000);
const hhmm = (h: number): string => `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.round((h % 1) * 60) % 60).padStart(2, '0')}`;

export class PhotoPanel {
  /** the panel is tucked away for a clean view */
  hidden = false;

  constructor(private photo: PhotoMode, private shoot: () => void, private leave: () => void) {
    $('pm-looks').innerHTML = Object.entries(LOOKS).map(([k, l]) => `<button data-look="${k}">${l.name}</button>`).join('');
    $('pm-wx').innerHTML = WEATHER.map(([k, n]) => `<button data-wx="${k ?? ''}">${n}</button>`).join('');
    const range = (id: string, set: (v: number) => void): void => {
      const el = $(id) as HTMLInputElement;
      el.addEventListener('input', () => { set(+el.value); this.sync(); });
      // hand the keyboard back to flying once the slider is let go
      el.addEventListener('change', () => el.blur());
      el.addEventListener('pointerup', () => el.blur());
    };
    range('pm-fov', (v) => { photo.fov = v; });
    range('pm-ev', (v) => { photo.ev = v; });
    range('pm-focus', (v) => { photo.focus = toFocus(v); photo.dof = true; });
    range('pm-blur', (v) => { photo.blur = v; photo.dof = true; });
    range('pm-hour', (v) => photo.setHour(v));
    $('pm-dof').addEventListener('click', () => { photo.dof = !photo.dof; this.sync(); });
    $('pm-hour-reset').addEventListener('click', () => { photo.setHour(null); this.sync(); });
    $('pm-looks').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-look]');
      if (b) { photo.look = b.dataset.look!; this.sync(); }
    });
    $('pm-wx').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-wx]');
      if (b) { photo.setWeather((b.dataset.wx || null) as WeatherPreview | null); this.sync(); }
    });
    $('pm-hide').addEventListener('click', () => this.toggle());
    $('pm-shoot').addEventListener('click', () => this.shoot());
    $('pm-exit').addEventListener('click', () => this.leave());
    // buttons give the keyboard back too
    $('photo').addEventListener('click', (e) => (e.target as HTMLElement).closest('button')?.blur());
  }

  show(): void {
    this.hidden = false;
    document.body.classList.add('photo');
    document.body.classList.remove('photo-clean');
    this.sync();
  }
  hide(): void {
    document.body.classList.remove('photo', 'photo-clean');
  }
  toggle(): void {
    this.hidden = !this.hidden;
    document.body.classList.toggle('photo-clean', this.hidden);
  }

  /** the controls follow the photo's state (the wheel zooms, a click focuses) */
  sync(): void {
    const p = this.photo;
    const set = (id: string, v: number): void => {
      const el = $(id) as HTMLInputElement;
      if (document.activeElement !== el) el.value = String(v);
    };
    set('pm-fov', Math.round(p.fov));
    $('pm-fov-v').textContent = `${Math.round(focalLength(p.fov))} mm`;
    set('pm-ev', p.ev);
    $('pm-ev-v').textContent = `${p.ev > 0 ? '+' : p.ev < 0 ? '−' : ''}${Math.abs(p.ev).toFixed(1)} EV`;
    set('pm-focus', fromFocus(p.focus));
    $('pm-focus-v').textContent = p.focus >= 100 ? `${Math.round(p.focus)} m` : `${p.focus.toFixed(p.focus < 10 ? 1 : 0)} m`;
    set('pm-blur', p.blur);
    $('pm-dof').textContent = p.dof ? 'On' : 'Off';
    $('pm-dof').classList.toggle('on', p.dof);
    document.getElementById('photo')!.classList.toggle('dof-off', !p.dof);
    set('pm-hour', p.hour ?? p.realHour);
    $('pm-hour-v').textContent = p.hour === null ? 'Now' : hhmm(p.hour);
    $('pm-hour-reset').toggleAttribute('disabled', p.hour === null);
    document.querySelectorAll<HTMLElement>('#pm-looks [data-look]').forEach((b) => b.classList.toggle('on', b.dataset.look === p.look));
    document.querySelectorAll<HTMLElement>('#pm-wx [data-wx]').forEach((b) => b.classList.toggle('on', (b.dataset.wx || null) === p.weather));
  }
}
