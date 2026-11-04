import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { register } from "@/api/auth";
import { looksLikeEmail, PASSWORD_MIN_LENGTH, toFormError } from "@/lib/formError";
import { CONSENTS_BY_ROLE, DOCUMENTS, type ConsentKey, type DocumentKey } from "@/shared/legal/documents";
import type { Role } from "@/shared/types/user";
import { Button } from "@/ui/Button";
import { Checkbox } from "@/ui/Checkbox";
import { Choice } from "@/ui/Choice";
import { LinkText } from "@/ui/LinkText";
import { Notice } from "@/ui/Notice";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

type FieldKey = "firstName" | "email" | "password" | "passwordConfirm" | "role";
const SERVER_FIELD: Record<string, FieldKey> = {
  first_name: "firstName",
  email: "email",
  password: "password",
  password_confirm: "passwordConfirm",
  role: "role",
};

const ROLES: { value: Role; title: string; hint: string }[] = [
  { value: "player", title: "Я игрок", hint: "Ищу тренера, веду тренировки и статистику" },
  { value: "coach", title: "Я тренер", hint: "Веду команды, публикую объявления и принимаю записи" },
];

function Doc({ doc, children }: { doc: DocumentKey; children: React.ReactNode }) {
  return <LinkText onPress={() => router.push({ pathname: "/legal/[key]", params: { key: doc } })}>{children}</LinkText>;
}

/** The wording next to each box, as in the approved scheme, with links to the documents it covers. */
const CONSENT_TEXT: Record<Role, Partial<Record<ConsentKey, React.ReactNode>>> = {
  player: {
    terms: (
      <>
        Принимаю <Doc doc="terms">Пользовательское соглашение</Doc>
      </>
    ),
    personal_data: (
      <>
        Даю согласие на обработку моих персональных данных на условиях <Doc doc="consent-player">Согласия</Doc> и в соответствии с{" "}
        <Doc doc="privacy">Политикой обработки персональных данных</Doc>.
      </>
    ),
  },
  coach: {
    coach_offer: (
      <>
        Принимаю условия <Doc doc="coach-offer">Оферты для тренеров</Doc>, в том числе{" "}
        <Doc doc="service-terms">Типовые условия оказания услуг тренером</Doc> как условия моих договоров со Спортсменами.
      </>
    ),
    personal_data: (
      <>
        Даю согласие на обработку моих персональных данных на условиях <Doc doc="consent-coach">Согласия</Doc> и в соответствии с{" "}
        <Doc doc="privacy">Политикой обработки персональных данных</Doc>.
      </>
    ),
    data_dissemination: (
      <>
        Даю согласие на распространение моих персональных данных, перечисленных в разделе 5{" "}
        <Doc doc="consent-coach-dissemination">Согласия</Doc>, в публичном профиле.
      </>
    ),
  },
};

export default function RegisterScreen() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [role, setRole] = useState<Role | null>(null);
  const [consents, setConsents] = useState<Partial<Record<ConsentKey, boolean>>>({});
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [consentErrors, setConsentErrors] = useState<Partial<Record<ConsentKey, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const clear = (field: FieldKey) => setErrors((current) => ({ ...current, [field]: undefined }));

  function chooseRole(next: Role) {
    if (next === role) return;
    setRole(next);
    // Boxes belong to a role: switching starts them over, so nothing ticked for the other role is ever sent.
    setConsents({});
    setConsentErrors({});
    clear("role");
  }

  async function submit() {
    if (busy) return;
    setFormError(null);
    const found: Partial<Record<FieldKey, string>> = {};
    if (!firstName.trim()) found.firstName = "Укажите имя.";
    if (!looksLikeEmail(email)) found.email = "Введите email полностью, например name@example.com.";
    if ([...password].length < PASSWORD_MIN_LENGTH) found.password = `Пароль слишком короткий: минимум ${PASSWORD_MIN_LENGTH} символов.`;
    if (password !== passwordConfirm) found.passwordConfirm = "Пароли не совпадают.";
    if (!role) found.role = "Выберите, кто вы: игрок или тренер.";
    const missing: Partial<Record<ConsentKey, string>> = {};
    if (role) {
      for (const consent of CONSENTS_BY_ROLE[role]) {
        if (!consents[consent.key]) missing[consent.key] = "Без этой отметки зарегистрироваться нельзя.";
      }
    }
    setErrors(found);
    setConsentErrors(missing);
    if (!role || Object.keys(found).length > 0 || Object.keys(missing).length > 0) return;

    setBusy(true);
    try {
      const result = await register({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        password,
        passwordConfirm,
        role,
        consents: CONSENTS_BY_ROLE[role].map((consent) => ({
          key: consent.key,
          documents: consent.documents.map((doc) => ({ key: doc, version: DOCUMENTS[doc].version })),
        })),
      });
      router.replace({ pathname: "/check-email", params: { email: result.email } });
    } catch (error) {
      const failure = toFormError(error);
      const field = failure.field ? SERVER_FIELD[failure.field] : undefined;
      if (field) setErrors({ [field]: failure.message });
      else setFormError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Text variant="title">Создать аккаунт</Text>
      <Text muted>Выберите роль, заполните данные и отметьте согласия. Поля со звёздочкой обязательны.</Text>
      {formError ? <Notice kind="danger">{formError}</Notice> : null}

      <Choice
        label="Кто вы? Роль выбирается один раз и потом не меняется"
        options={ROLES}
        value={role}
        onChange={chooseRole}
        error={errors.role}
        disabled={busy}
      />
      <TextField
        label="Имя"
        required
        value={firstName}
        onChangeText={(v) => {
          setFirstName(v);
          clear("firstName");
        }}
        autoComplete="given-name"
        error={errors.firstName}
      />
      <TextField label="Фамилия" value={lastName} onChangeText={setLastName} autoComplete="family-name" />
      <TextField
        label="Email"
        required
        value={email}
        onChangeText={(v) => {
          setEmail(v);
          clear("email");
        }}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        error={errors.email}
      />
      <TextField
        label={`Пароль (минимум ${PASSWORD_MIN_LENGTH} символов)`}
        required
        value={password}
        onChangeText={(v) => {
          setPassword(v);
          clear("password");
        }}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        error={errors.password}
      />
      <TextField
        label="Повторите пароль"
        required
        value={passwordConfirm}
        onChangeText={(v) => {
          setPasswordConfirm(v);
          clear("passwordConfirm");
        }}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        error={errors.passwordConfirm}
      />

      {role ? (
        <View style={{ gap: 14 }}>
          {CONSENTS_BY_ROLE[role].map((consent) => (
            <Checkbox
              key={consent.key}
              checked={!!consents[consent.key]}
              onChange={(checked) => {
                setConsents((current) => ({ ...current, [consent.key]: checked }));
                setConsentErrors((current) => ({ ...current, [consent.key]: undefined }));
              }}
              error={consentErrors[consent.key]}
            >
              <Text variant="caption">{CONSENT_TEXT[role][consent.key]}</Text>
            </Checkbox>
          ))}
        </View>
      ) : null}

      <Button title="Зарегистрироваться" onPress={submit} loading={busy} />
      <Text muted style={{ textAlign: "center" }}>
        Уже есть аккаунт? <LinkText onPress={() => router.replace("/login")}>Войти</LinkText>
      </Text>
    </Screen>
  );
}
