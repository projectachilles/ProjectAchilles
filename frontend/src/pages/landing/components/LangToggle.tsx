import type { Lang } from '../i18n';

type Props = {
  lang: Lang;
  onChange: (lang: Lang) => void;
};

export function LangToggle({ lang, onChange }: Props) {
  return (
    <div className="lp-lang" role="group" aria-label="Language">
      {(['en', 'es'] as const).map((l, i) => (
        <span key={l} style={{ display: 'contents' }}>
          {i > 0 && <span aria-hidden="true">/</span>}
          <button type="button" onClick={() => onChange(l)} aria-pressed={lang === l}>
            {l}
          </button>
        </span>
      ))}
    </div>
  );
}
