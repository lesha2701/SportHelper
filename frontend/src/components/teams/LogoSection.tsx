import { useState } from "react";
import { uploadTeamLogo } from "../../api/teams";
import { ApiError } from "../../api/client";
import { FilePicker } from "../shared/FilePicker";
import profileStyles from "../profile/profile.module.css";

interface LogoSectionProps {
  token: string;
  teamId: string;
  onUploaded: () => void;
}

export function LogoSection({ token, teamId, onUploaded }: LogoSectionProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      await uploadTeamLogo(token, teamId, file);
      onUploaded();
    } catch (err) {
      if (err instanceof ApiError && err.code === "unsupported_media_type") {
        setError("Логотип должен быть изображением (jpeg, png, webp или gif).");
      } else if (err instanceof ApiError && err.code === "file_too_large") {
        setError(err.message);
      } else {
        setError(err instanceof ApiError ? err.message : "Не удалось загрузить логотип");
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className={profileStyles.card}>
      <h2 className={profileStyles.title}>Логотип команды</h2>
      {error && <p className={profileStyles.error}>{error}</p>}
      <FilePicker
        icon="image"
        label={uploading ? "Загрузка…" : "Выбрать логотип"}
        hint="JPEG, PNG, WEBP или GIF"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onSelect={(file) => void handleFile(file)}
        disabled={uploading}
      />
    </div>
  );
}
