import { C } from "../theme";
import { FF_SERIF } from "../fonts";

export const Wordmark: React.FC<{ size?: number }> = ({ size = 48 }) => {
  return (
    <span
      style={{
        fontFamily: FF_SERIF,
        fontSize: size,
        fontWeight: 600,
        letterSpacing: "-0.02em",
        color: C.ink,
        lineHeight: 1,
      }}
    >
      legendflow
      <span style={{ color: C.orange }}>.</span>
    </span>
  );
};

export const Caption: React.FC<{ children: React.ReactNode; size?: number }> = ({
  children,
  size = 22,
}) => (
  <div
    style={{
      fontSize: size,
      color: C.mute,
      letterSpacing: "0.18em",
      textTransform: "uppercase",
      fontWeight: 500,
    }}
  >
    {children}
  </div>
);
