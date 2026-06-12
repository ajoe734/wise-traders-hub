import { Composition } from "remotion";
import { MainVideo } from "./MainVideo";
import { FPS } from "./theme";

const DURATION = 660; // 22s @ 30fps (Checkup 加長 2s)

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="holdings-promo-16x9"
        component={MainVideo}
        durationInFrames={DURATION}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={{ orientation: "landscape" as const }}
      />
      <Composition
        id="holdings-promo-9x16"
        component={MainVideo}
        durationInFrames={DURATION}
        fps={FPS}
        width={1080}
        height={1920}
        defaultProps={{ orientation: "portrait" as const }}
      />
    </>
  );
};
