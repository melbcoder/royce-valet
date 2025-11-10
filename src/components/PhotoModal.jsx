import React, { useState, useRef, useEffect } from "react";
import Modal from "./Modal";
import { storage } from "../services/valetFirestore";
import { ref, uploadBytes, getDownloadURL, listAll, deleteObject } from "firebase/storage";
import { updateVehicle } from "../services/valetFirestore";
import { showToast } from "./Toast";

const PHOTO_ANGLES = [
  { key: "front", label: "Front" },
  { key: "rear", label: "Rear" },
  { key: "left", label: "Left Side" },
  { key: "right", label: "Right Side" },
];

export default function PhotoModal({ open, onClose, vehicleTag, vehicle }) {
  const [photos, setPhotos] = useState({
    front: null,
    rear: null,
    left: null,
    right: null,
  });
  const [previews, setPreviews] = useState({
    front: null,
    rear: null,
    left: null,
    right: null,
  });
  const [uploading, setUploading] = useState(false);
  const [activeAngle, setActiveAngle] = useState("front");
  const fileInputRefs = useRef({});

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setPhotos({ front: null, rear: null, left: null, right: null });
      setActiveAngle("front");
    }
  }, [open]);

  // Load existing photos when modal opens
  useEffect(() => {
    if (open && vehicleTag) {
      loadExistingPhotos();
    }
  }, [open, vehicleTag]);

  const loadExistingPhotos = async () => {
    if (!vehicleTag) return;

    const newPreviews = { front: null, rear: null, left: null, right: null };

    for (const angle of PHOTO_ANGLES) {
      try {
        const photoRef = ref(storage, `vehicles/${vehicleTag}/${angle.key}.jpg`);
        const url = await getDownloadURL(photoRef);
        newPreviews[angle.key] = url;
      } catch (error) {
        // Photo doesn't exist yet - this is normal
        console.log(`No ${angle.key} photo found`);
      }
    }

    setPreviews(newPreviews);
  };

  const handleFileSelect = (angle, e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      showToast("Please select an image file.");
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      showToast("Image must be smaller than 10MB.");
      return;
    }

    setPhotos((prev) => ({ ...prev, [angle]: file }));

    // Create preview
    const reader = new FileReader();
    reader.onloadend = () => {
      setPreviews((prev) => ({ ...prev, [angle]: reader.result }));
    };
    reader.readAsDataURL(file);
  };

  const handleRemovePhoto = (angle) => {
    setPhotos((prev) => ({ ...prev, [angle]: null }));
    // Don't remove preview if it's from server - only clear if it's a new photo
    if (photos[angle]) {
      setPreviews((prev) => ({ ...prev, [angle]: null }));
    }
    if (fileInputRefs.current[angle]) {
      fileInputRefs.current[angle].value = "";
    }
  };

  const handleUpload = async () => {
    if (!vehicleTag) {
      console.error("No vehicleTag provided");
      showToast("Error: No vehicle tag");
      return;
    }

    console.log("Starting upload for vehicle:", vehicleTag);
    console.log("Photos to upload:", Object.entries(photos).filter(([k, v]) => v !== null));
    
    setUploading(true);
    try {
      const uploadPromises = [];
      let uploadCount = 0;

      for (const angle of PHOTO_ANGLES) {
        const file = photos[angle.key];
        if (file) {
          console.log(`Preparing to upload ${angle.key} photo, size: ${file.size} bytes`);
          const photoRef = ref(storage, `vehicles/${vehicleTag}/${angle.key}.jpg`);
          console.log(`Storage path: vehicles/${vehicleTag}/${angle.key}.jpg`);
          
          uploadPromises.push(
            uploadBytes(photoRef, file)
              .then((snapshot) => {
                uploadCount++;
                console.log(`${angle.key} uploaded successfully`, snapshot);
                return snapshot;
              })
              .catch((err) => {
                console.error(`Failed to upload ${angle.key}:`, err);
                throw err;
              })
          );
        }
      }

      if (uploadPromises.length === 0) {
        showToast("No new photos to upload.");
        setUploading(false);
        return;
      }

      console.log(`Uploading ${uploadPromises.length} photos...`);
      const results = await Promise.all(uploadPromises);
      console.log("All uploads complete:", results);

      // Update vehicle record with photo timestamp
      console.log("Updating vehicle record...");
      await updateVehicle(vehicleTag, {
        photosUpdatedAt: Date.now(),
      });

      console.log(`Successfully uploaded ${uploadCount} photos`);
      showToast(`${uploadCount} photo(s) uploaded successfully.`);
      
      // Reload photos to show saved versions
      console.log("Reloading photos from storage...");
      await loadExistingPhotos();
      
      // Clear the new photos state
      setPhotos({ front: null, rear: null, left: null, right: null });
      
    } catch (error) {
      console.error("Upload error:", error);
      console.error("Error code:", error.code);
      console.error("Error message:", error.message);
      showToast(`Failed to upload photos: ${error.message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleDeletePhoto = async (angle) => {
    if (!vehicleTag) return;

    try {
      const photoRef = ref(storage, `vehicles/${vehicleTag}/${angle}.jpg`);
      await deleteObject(photoRef);
      setPreviews((prev) => ({ ...prev, [angle]: null }));
      setPhotos((prev) => ({ ...prev, [angle]: null }));
      showToast(`${angle} photo deleted.`);
    } catch (error) {
      console.error("Delete error:", error);
      showToast("Failed to delete photo.");
    }
  };

  const hasNewPhotos = Object.values(photos).some((p) => p !== null);
  const hasAnyPhotos = Object.values(previews).some((p) => p !== null);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Vehicle Photos - #${vehicleTag || ""}`}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {vehicle && (
          <div style={{ padding: 12, background: "#f8f8f8", borderRadius: 8 }}>
            <strong>{vehicle.guestName}</strong>
            <br />
            {vehicle.color} {vehicle.make} • {vehicle.license}
          </div>
        )}

        {/* Angle Tabs */}
        <div style={{ display: "flex", gap: 8, borderBottom: "2px solid #eee" }}>
          {PHOTO_ANGLES.map((angle) => (
            <button
              key={angle.key}
              onClick={() => setActiveAngle(angle.key)}
              style={{
                padding: "8px 16px",
                background: activeAngle === angle.key ? "#000" : "transparent",
                color: activeAngle === angle.key ? "#fff" : "#000",
                border: "none",
                borderRadius: "8px 8px 0 0",
                cursor: "pointer",
                fontWeight: activeAngle === angle.key ? "bold" : "normal",
              }}
            >
              {angle.label}
              {previews[angle.key] && " ✓"}
            </button>
          ))}
        </div>

        {/* Active Photo View */}
        <div style={{ minHeight: 300, display: "flex", flexDirection: "column", gap: 12 }}>
          {previews[activeAngle] ? (
            <div style={{ position: "relative" }}>
              <img
                src={previews[activeAngle]}
                alt={`${activeAngle} view`}
                style={{
                  width: "100%",
                  maxHeight: 400,
                  objectFit: "contain",
                  borderRadius: 8,
                  border: "1px solid #ddd",
                }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                {photos[activeAngle] ? (
                  <button
                    className="btn secondary"
                    onClick={() => handleRemovePhoto(activeAngle)}
                  >
                    Cancel Upload
                  </button>
                ) : (
                  <>
                    <button
                      className="btn secondary"
                      onClick={() => handleRemovePhoto(activeAngle)}
                    >
                      Replace
                    </button>
                    <button
                      className="btn secondary"
                      onClick={() => handleDeletePhoto(activeAngle)}
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div
              style={{
                border: "2px dashed #ddd",
                borderRadius: 8,
                padding: 32,
                textAlign: "center",
                background: "#fafafa",
              }}
            >
              <p style={{ marginBottom: 16, opacity: 0.7 }}>
                No {activeAngle} photo yet
              </p>
              <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                <input
                  ref={(el) => (fileInputRefs.current[activeAngle] = el)}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => handleFileSelect(activeAngle, e)}
                  style={{ display: "none" }}
                  id={`file-${activeAngle}`}
                />
                <button
                  className="btn primary"
                  onClick={() => fileInputRefs.current[activeAngle]?.click()}
                >
                  Add Photo
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          {hasNewPhotos && (
            <button
              className="btn primary"
              onClick={handleUpload}
              disabled={uploading}
            >
              {uploading ? "Uploading..." : "Save Photos"}
            </button>
          )}
          <button className="btn secondary" onClick={onClose} disabled={uploading}>
            {hasNewPhotos ? "Cancel" : "Close"}
          </button>
        </div>

        {!hasAnyPhotos && !hasNewPhotos && (
          <p style={{ fontSize: 12, opacity: 0.6, textAlign: "center" }}>
            Capture all four angles for complete vehicle documentation
          </p>
        )}
      </div>
    </Modal>
  );
}