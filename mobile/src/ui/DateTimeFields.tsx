import { StyleSheet, View } from "react-native";
import { addDays, formatRuDate, parseRuDate, parseTime, todayIso } from "@/shared/lib/dates";
import { Choice } from "./Choice";
import { TextField } from "./TextField";

interface DateProps {
  label: string;
  /** What the person typed ("ДД.ММ.ГГГГ"); the parent validates it with parseRuDate. */
  value: string;
  onChange: (text: string) => void;
  error?: string | null;
  required?: boolean;
  /** Offer "today / tomorrow" shortcuts. */
  shortcuts?: boolean;
}

/** A date typed as ДД.ММ.ГГГГ, with shortcuts for the usual days. */
export function DateField({ label, value, onChange, error, required, shortcuts }: DateProps) {
  const today = todayIso();
  const options = [
    { value: today, title: "Сегодня" },
    { value: addDays(today, 1), title: "Завтра" },
    { value: addDays(today, 7), title: "Через неделю" },
  ];
  const current = parseRuDate(value);
  return (
    <View style={styles.wrap}>
      <TextField
        label={label}
        required={required}
        value={value}
        onChangeText={onChange}
        placeholder="ДД.ММ.ГГГГ"
        keyboardType="numbers-and-punctuation"
        maxLength={10}
        error={error}
      />
      {shortcuts ? (
        <Choice layout="chips" options={options} value={current} onChange={(iso) => onChange(formatRuDate(iso))} />
      ) : null}
    </View>
  );
}

interface TimeProps {
  label: string;
  value: string;
  onChange: (text: string) => void;
  error?: string | null;
  required?: boolean;
}

/** A time typed as ЧЧ:ММ. */
export function TimeField({ label, value, onChange, error, required }: TimeProps) {
  return (
    <TextField
      label={label}
      required={required}
      value={value}
      onChangeText={onChange}
      placeholder="ЧЧ:ММ"
      keyboardType="numbers-and-punctuation"
      maxLength={5}
      error={error}
    />
  );
}

export { parseRuDate, parseTime };

const styles = StyleSheet.create({ wrap: { gap: 8 } });
