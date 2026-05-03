import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PhotoView } from "@/components/chat/PhotoView";

const ORIGINAL = "https://storage.googleapis.com/jacob-media-public-staging/uploads/uid123/photo.jpg";

describe("PhotoView", () => {
  it("renders srcset with all three variants", () => {
    render(<PhotoView src={ORIGINAL} alt="test photo" />);
    const img = screen.getByRole("img");

    expect(img).toHaveAttribute("src", ORIGINAL);
    const srcset = img.getAttribute("srcset") ?? "";
    expect(srcset).toContain("derived/uid123/photo_320.jpg 320w");
    expect(srcset).toContain("derived/uid123/photo_640.jpg 640w");
    expect(srcset).toContain("derived/uid123/photo_1280.jpg 1280w");
  });

  it("sets lazy loading on offscreen images", () => {
    const { container } = render(<PhotoView src={ORIGINAL} alt="" />);
    const img = container.querySelector("img");
    expect(img).toHaveAttribute("loading", "lazy");
  });

  it("wraps in a fixed aspect-ratio container to prevent CLS", () => {
    const { container } = render(<PhotoView src={ORIGINAL} alt="" />);
    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain("aspect-[4/3]");
  });

  it("handles PNG originals by stripping the extension correctly", () => {
    const png = ORIGINAL.replace(".jpg", ".png");
    const { container } = render(<PhotoView src={png} alt="" />);
    const img = container.querySelector("img");
    const srcset = img?.getAttribute("srcset") ?? "";
    expect(srcset).toContain("photo_320.jpg 320w");
    expect(srcset).not.toContain("photo.png");
  });
});
