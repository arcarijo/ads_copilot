import { describe, it, expect } from "vitest";
import { normalizeMediaUrl, extractDriveFolderId, interpretFolderListing } from "../lib/drive";

describe("extractDriveFolderId", () => {
  it("pulls the id from a folder share link", () => {
    expect(extractDriveFolderId("https://drive.google.com/drive/folders/1AbC_def-GHI2345?usp=sharing")).toBe("1AbC_def-GHI2345");
  });
  it("rejects a FILE link (only /folders/ counts)", () => {
    expect(extractDriveFolderId("https://drive.google.com/file/d/1AbC_def-GHI2345/view")).toBeNull();
  });
  it("rejects non-Drive and junk URLs", () => {
    expect(extractDriveFolderId("https://evil.com/drive/folders/1AbC_def-GHI2345")).toBeNull();
    expect(extractDriveFolderId("not a url")).toBeNull();
    expect(extractDriveFolderId("")).toBeNull();
  });
  it("won't accept a short/injection id", () => {
    expect(extractDriveFolderId("https://drive.google.com/drive/folders/'; DROP")).toBeNull();
  });
});

describe("interpretFolderListing", () => {
  const img = (id: string, name: string) => ({ id, name, mimeType: "image/jpeg" });

  it("accepts 2–10 images and returns them", () => {
    const r = interpretFolderListing([img("a", "1.jpg"), img("b", "2.jpg"), img("c", "3.png")]);
    expect(r.ok).toBe(true);
    expect(r.count).toBe(3);
    expect(r.images.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });
  it("ignores non-image files when counting", () => {
    const r = interpretFolderListing([img("a", "1.jpg"), img("b", "2.jpg"), { id: "v", name: "clip.mp4", mimeType: "video/mp4" }]);
    expect(r.ok).toBe(true);
    expect(r.count).toBe(2);
  });
  it("rejects an empty / image-less folder", () => {
    expect(interpretFolderListing([]).ok).toBe(false);
    expect(interpretFolderListing([{ id: "v", name: "clip.mp4", mimeType: "video/mp4" }]).ok).toBe(false);
  });
  it("rejects a single image (needs 2+)", () => {
    const r = interpretFolderListing([img("a", "1.jpg")]);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/at least 2/);
  });
  it("rejects more than 10 images", () => {
    const many = Array.from({ length: 11 }, (_, i) => img(String(i), `${i}.jpg`));
    const r = interpretFolderListing(many);
    expect(r.ok).toBe(false);
    expect(r.count).toBe(11);
    expect(r.images).toEqual([]); // not returned when over the cap
  });
});

describe("normalizeMediaUrl (unchanged file path still works)", () => {
  it("turns a Drive file link into a direct-download URL", () => {
    const n = normalizeMediaUrl("https://drive.google.com/file/d/1AbC_def-GHI2345/view");
    expect(n?.isDrive).toBe(true);
    expect(n?.url).toContain("uc?export=download&id=1AbC_def-GHI2345");
  });
});
