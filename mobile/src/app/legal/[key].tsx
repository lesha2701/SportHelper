import { Stack, useLocalSearchParams } from "expo-router";
import { Linking, View } from "react-native";
import { DOCUMENTS, type DocumentKey } from "@/shared/legal/documents";
import { loadDocument } from "@/shared/legal/loader";
import type { Block, Run } from "@/shared/legal/types";
import { Screen } from "@/ui/Screen";
import { LinkText } from "@/ui/LinkText";
import { Text } from "@/ui/Text";
import { fonts } from "@/theme/tokens";

function Runs({ runs }: { runs: Run[] }) {
  return (
    <>
      {runs.map((run, index) =>
        run.href ? (
          <LinkText key={index} onPress={() => void Linking.openURL(run.href!)}>
            {run.t}
          </LinkText>
        ) : (
          <Text key={index} style={{ fontFamily: run.b ? fonts.bodyBold : run.i ? fonts.body : undefined, fontStyle: run.i ? "italic" : "normal" }}>
            {run.t}
          </Text>
        ),
      )}
    </>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case "h1":
      return (
        <Text variant="heading">
          <Runs runs={block.runs} />
        </Text>
      );
    case "h2":
      return (
        <Text variant="label" style={{ fontSize: 15, marginTop: 8 }}>
          <Runs runs={block.runs} />
        </Text>
      );
    case "p":
      return (
        <Text style={{ textAlign: block.align === "center" ? "center" : "left" }}>
          <Runs runs={block.runs} />
        </Text>
      );
    case "ul":
    case "ol":
      return (
        <View style={{ gap: 6 }}>
          {block.items.map((item, index) => (
            <View key={index} style={{ flexDirection: "row", gap: 8 }}>
              <Text>{block.type === "ol" ? `${index + 1}.` : "•"}</Text>
              <Text style={{ flex: 1 }}>
                <Runs runs={item} />
              </Text>
            </View>
          ))}
        </View>
      );
    case "table":
      return (
        <View style={{ gap: 8 }}>
          {block.rows.map((row, r) => (
            <View key={r} style={{ gap: 4 }}>
              {row.map((cell, c) => (
                <Text key={c} variant="caption">
                  {cell.flat().map((run) => run.t).join(" ")}
                </Text>
              ))}
            </View>
          ))}
        </View>
      );
  }
}

export default function LegalDocumentScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const meta = DOCUMENTS[key as DocumentKey];
  if (!meta) {
    return (
      <Screen centered>
        <Text variant="heading">Документ не найден</Text>
      </Screen>
    );
  }
  const doc = loadDocument(meta.key);
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: meta.label }} />
      <Screen header>
        {doc.blocks.map((block, index) => (
          <BlockView key={index} block={block} />
        ))}
      </Screen>
    </>
  );
}
