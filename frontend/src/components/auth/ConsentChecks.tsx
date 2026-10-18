import type { ReactNode } from "react";
import { CONSENTS_BY_ROLE, DOCUMENTS, type ConsentKey, type DocumentKey } from "../../legal/documents";
import type { Role } from "../../types/user";
import { Link } from "../Link";
import { Checkbox } from "./fields";
import styles from "./auth.module.css";

function DocLink({ doc, children }: { doc: DocumentKey; children: ReactNode }) {
  return (
    <Link to={DOCUMENTS[doc].path} className={styles.link} target="_blank" rel="noopener">
      {children}
    </Link>
  );
}

/** The wording next to each box, as in the approved scheme: what is accepted, with links to the documents it covers. */
const CONSENT_TEXT: Record<Role, Partial<Record<ConsentKey, ReactNode>>> = {
  player: {
    terms: (
      <>
        Принимаю <DocLink doc="terms">Пользовательское соглашение</DocLink>
      </>
    ),
    personal_data: (
      <>
        Даю согласие на обработку моих персональных данных на условиях <DocLink doc="consent-player">Согласия</DocLink> и в соответствии с{" "}
        <DocLink doc="privacy">Политикой обработки персональных данных</DocLink>.
      </>
    ),
  },
  coach: {
    coach_offer: (
      <>
        Принимаю условия <DocLink doc="coach-offer">Оферты для тренеров</DocLink>, в том числе{" "}
        <DocLink doc="service-terms">Типовые условия оказания услуг тренером</DocLink> как условия моих договоров со Спортсменами.
      </>
    ),
    personal_data: (
      <>
        Даю согласие на обработку моих персональных данных на условиях <DocLink doc="consent-coach">Согласия</DocLink> и в соответствии с{" "}
        <DocLink doc="privacy">Политикой обработки персональных данных</DocLink>.
      </>
    ),
    data_dissemination: (
      <>
        Даю согласие на распространение моих персональных данных, перечисленных в разделе 5{" "}
        <DocLink doc="consent-coach-dissemination">Согласия</DocLink>, в публичном профиле.
      </>
    ),
  },
};

export type ConsentState = Partial<Record<ConsentKey, boolean>>;

/** The role's check boxes, all unticked to begin with and each ticked on its own. */
export function ConsentChecks({
  role,
  value,
  errors,
  disabled,
  onChange,
}: {
  role: Role;
  value: ConsentState;
  errors: Partial<Record<ConsentKey, string>>;
  disabled?: boolean;
  onChange: (key: ConsentKey, checked: boolean) => void;
}) {
  return (
    <>
      {CONSENTS_BY_ROLE[role].map((consent) => (
        <Checkbox
          key={consent.key}
          checked={value[consent.key] === true}
          onChange={(checked) => onChange(consent.key, checked)}
          error={errors[consent.key]}
          disabled={disabled}
        >
          {CONSENT_TEXT[role][consent.key]}
        </Checkbox>
      ))}
    </>
  );
}
