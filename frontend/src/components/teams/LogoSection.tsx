import { useRef, useState } from "react";
import { uploadTeamLogo } from "../../api/teams";
import { ApiError } from "../../api/client";
import profileStyles from "../profile/profile.module.css";

interface LogoSectionProps {
  token: string;
  teamId: string;
  onUploaded: () => void;
}

export function LogoSection({ token, teamId, onUploaded }: LogoSectionProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
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
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className={profileStyles.card}>
      <h2 className={profileStyles.title}>Логотип команды</h2>
      {error && <p className={profileStyles.error}>{error}</p>}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={(e) => void handleFileChange(e)}
        disabled={uploading}
      />
      {uploading && <p className={profileStyles.subtitle}>Загрузка…</p>}
    </div>
  );
}
