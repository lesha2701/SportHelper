import { useState } from "react";
import { AuthenticatedImage } from "../shared/AuthenticatedImage";
import styles from "./blog.module.css";

/** Up to three photos of an article: arrows and dots; a photo opens in the full-screen viewer. */
export function Carousel({ imageIds, title }: { imageIds: string[]; title: string }) {
  const [index, setIndex] = useState(0);
  const current = imageIds[index] ?? imageIds[0];
  if (!current) return null;
  const gallery = imageIds.map((fileId) => ({ kind: "image" as const, fileId, alt: title }));
  const go = (step: number) => setIndex((i) => (i + step + imageIds.length) % imageIds.length);

  return (
    <div className={styles.carousel} aria-roledescription="карусель" aria-label="Фото к статье">
      <AuthenticatedImage
        key={current}
        token=""
        fileId={current}
        alt={`${title}, фото ${index + 1} из ${imageIds.length}`}
        className={styles.slide}
        zoomable
        gallery={gallery}
        galleryIndex={index}
      />
      {imageIds.length > 1 && (
        <>
          <button type="button" className={styles.carouselButton} style={{ left: 10 }} aria-label="Предыдущее фото" onClick={() => go(-1)}>
            ‹
          </button>
          <button type="button" className={styles.carouselButton} style={{ right: 10 }} aria-label="Следующее фото" onClick={() => go(1)}>
            ›
          </button>
          <div className={styles.dots} aria-hidden="true">
            {imageIds.map((id, i) => (
              <span key={id} className={`${styles.dot} ${i === index ? styles.dotOn : ""}`} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
