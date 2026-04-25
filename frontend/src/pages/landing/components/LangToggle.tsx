import type { Lang } from '../i18n';

type Props = {
  lang: Lang;
  onChange: (lang: Lang) => void;
};

export function LangToggle({ lang, onChange }: Props) {
  return (
    <div className="lang-toggle" role="group" aria-label="Language">
      {(['en', 'es'] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => onChange(l)}
          className={lang === l ? 'active' : ''}
          aria-pressed={lang === l}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
