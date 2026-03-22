import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import Modal from '../components/Modal';
import { showToast } from '../components/Toast';
import {
  storage,
  getCurrentUser,
  createMaintenanceJob,
  updateMaintenanceJob,
  acceptMaintenanceJob,
  addJobUpdate,
  completeMaintenanceJob,
  deleteMaintenanceJob,
  subscribeMaintenanceJobs,
} from '../services/valetFirestore';

// ─── Constants ────────────────────────────────────────────────────────────────

const PRIORITY_CONFIG = {
  low:    { label: 'Low',    color: '#3d9e5f', bg: '#e8f8ef' },
  normal: { label: 'Normal', color: '#3c78c8', bg: '#e8f0fb' },
  high:   { label: 'High',   color: '#c47c0a', bg: '#fef3e2' },
  urgent: { label: 'Urgent', color: '#c93030', bg: '#fde8e8' },
};

const STATUS_CONFIG = {
  open:      { label: 'Open',      color: '#555',    bg: '#ebebeb' },
  accepted:  { label: 'Accepted',  color: '#3c78c8', bg: '#e8f0fb' },
  completed: { label: 'Completed', color: '#3d9e5f', bg: '#e8f8ef' },
};

const MAX_PHOTOS = 5;
const MAX_PHOTO_SIZE = 10 * 1024 * 1024; // 10 MB

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(ms) {
  if (!ms) return '';
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function Pill({ label, color, bg, style = {} }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '3px 10px',
      borderRadius: 999,
      fontSize: 12,
      fontWeight: 700,
      color,
      background: bg,
      letterSpacing: '0.04em',
      ...style,
    }}>
      {label}
    </span>
  );
}

function PhotoStrip({ urls, onRemove }) {
  if (!urls || urls.length === 0) return null;
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
      {urls.map((src, i) => (
        <div key={i} style={{ position: 'relative' }}>
          <img
            src={src}
            alt={`photo ${i + 1}`}
            style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 10, border: '1px solid rgba(0,0,0,.12)', cursor: 'pointer' }}
            onClick={() => window.open(src, '_blank')}
          />
          {onRemove && (
            <button
              onClick={() => onRemove(i)}
              aria-label="Remove photo"
              style={{
                position: 'absolute', top: -6, right: -6,
                width: 20, height: 20, borderRadius: 999,
                background: '#333', color: '#fff', border: 'none',
                cursor: 'pointer', fontSize: 12, lineHeight: '20px',
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
              }}
            >×</button>
          )}
        </div>
      ))}
    </div>
  );
}

async function uploadPhotos(jobId, subPath, files) {
  const urls = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const path = `maintenanceJobs/${jobId}/${subPath}/photo-${Date.now()}-${i}`;
    const r = storageRef(storage, path);
    await uploadBytes(r, file);
    const url = await getDownloadURL(r);
    urls.push(url);
  }
  return urls;
}

function usePhotoState() {
  const [files, setFiles] = useState([]);
  const [previews, setPreviews] = useState([]);
  const inputRef = useRef(null);

  const addFiles = useCallback((incoming) => {
    const valid = Array.from(incoming).filter(f => {
      if (!f.type.startsWith('image/')) { showToast('Only image files are allowed'); return false; }
      if (f.size > MAX_PHOTO_SIZE) { showToast('Each photo must be under 10 MB'); return false; }
      return true;
    });
    if (files.length + valid.length > MAX_PHOTOS) {
      showToast(`Maximum ${MAX_PHOTOS} photos allowed`);
      return;
    }
    valid.forEach(file => {
      const reader = new FileReader();
      reader.onload = e => {
        setFiles(prev => [...prev, file]);
        setPreviews(prev => [...prev, e.target.result]);
      };
      reader.readAsDataURL(file);
    });
  }, [files.length]);

  const remove = useCallback((index) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
    setPreviews(prev => prev.filter((_, i) => i !== index));
  }, []);

  const reset = useCallback(() => {
    setFiles([]);
    setPreviews([]);
    if (inputRef.current) inputRef.current.value = '';
  }, []);

  return { files, previews, addFiles, remove, reset, inputRef };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PhotoUploadRow({ photoState, label = 'Add Photos' }) {
  const { previews, addFiles, remove, inputRef } = photoState;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          className="btn secondary"
          style={{ fontSize: 13, padding: '8px 14px' }}
          onClick={() => inputRef.current?.click()}
        >
          📷 {label}
        </button>
        {previews.length > 0 && (
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{previews.length} / {MAX_PHOTOS}</span>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        style={{ display: 'none' }}
        onChange={e => { addFiles(e.target.files); if (inputRef.current) inputRef.current.value = ''; }}
      />
      <PhotoStrip urls={previews} onRemove={remove} />
    </div>
  );
}

function JobCard({ job, onView, onAccept, currentUsername }) {
  const pc = PRIORITY_CONFIG[job.priority] || PRIORITY_CONFIG.normal;
  const sc = STATUS_CONFIG[job.status] || STATUS_CONFIG.open;
  const isOpen = job.status === 'open';
  const photoCount = (job.photoUrls || []).length;
  const updateCount = (job.updates || []).length;

  return (
    <div
      className="card"
      style={{
        padding: '14px 16px',
        borderLeft: `4px solid ${pc.color}`,
        cursor: 'pointer',
        transition: 'box-shadow 0.15s',
      }}
      onClick={() => onView(job)}
    >
      {/* Top row: priority + status + time */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
        <Pill label={pc.label} color={pc.color} bg={pc.bg} />
        <Pill label={sc.label} color={sc.color} bg={sc.bg} />
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }}>{timeAgo(job.createdAtMs)}</span>
      </div>

      {/* Title */}
      <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 2 }}>{job.title}</div>

      {/* Location */}
      {job.location && (
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>📍 {job.location}</div>
      )}

      {/* Footer row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>By {job.createdBy}</span>
        {job.acceptedBy && (
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>· Accepted by {job.acceptedBy}</span>
        )}
        {photoCount > 0 && <span style={{ fontSize: 12, color: 'var(--muted)' }}>· 🖼 {photoCount}</span>}
        {updateCount > 0 && <span style={{ fontSize: 12, color: 'var(--muted)' }}>· 💬 {updateCount}</span>}

        {isOpen && (
          <button
            className="btn"
            style={{ marginLeft: 'auto', fontSize: 13, padding: '7px 16px' }}
            onClick={e => { e.stopPropagation(); onAccept(job); }}
          >
            Accept
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'completed', label: 'Completed' },
];

const BLANK_JOB = { title: '', description: '', location: '', priority: 'normal' };

export default function MaintenanceJobs() {
  const currentUser = getCurrentUser();
  const currentUsername = currentUser?.username || 'unknown';

  // ── Live data ──
  const [jobs, setJobs] = useState([]);
  useEffect(() => subscribeMaintenanceJobs(setJobs), []);

  // ── Filters ──
  const [filter, setFilter] = useState('all');
  const filteredJobs = filter === 'all' ? jobs : jobs.filter(j => j.status === filter);

  // ── Create modal ──
  const [createOpen, setCreateOpen] = useState(false);
  const [newJob, setNewJob] = useState({ ...BLANK_JOB });
  const createPhotos = usePhotoState();
  const [creating, setCreating] = useState(false);

  // ── Detail modal ──
  const [selectedJob, setSelectedJob] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // Keep selectedJob in sync with live updates
  useEffect(() => {
    if (selectedJob) {
      const live = jobs.find(j => j.id === selectedJob.id);
      if (live) setSelectedJob(live);
    }
  }, [jobs]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Edit modal ──
  const [editOpen, setEditOpen] = useState(false);
  const [editJob, setEditJob] = useState({ ...BLANK_JOB });
  const [saving, setSaving] = useState(false);

  // ── Delete confirm ──
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [jobToDelete, setJobToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // ── Add update ──
  const [updateText, setUpdateText] = useState('');
  const updatePhotos = usePhotoState();
  const [submitting, setSubmitting] = useState(false);

  // ── Full-screen photo viewer ──
  const [lightboxUrl, setLightboxUrl] = useState(null);

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const openCreate = () => {
    setNewJob({ ...BLANK_JOB });
    createPhotos.reset();
    setCreateOpen(true);
  };

  const handleCreate = async () => {
    if (!newJob.title.trim()) { showToast('Title is required'); return; }
    setCreating(true);
    try {
      const id = await createMaintenanceJob({ ...newJob, photoUrls: [] });
      if (createPhotos.files.length > 0) {
        const urls = await uploadPhotos(id, 'photos', createPhotos.files);
        await updateMaintenanceJob(id, { photoUrls: urls });
      }
      setCreateOpen(false);
      showToast('Job created');
    } catch (err) {
      console.error(err);
      showToast('Failed to create job');
    } finally {
      setCreating(false);
    }
  };

  const openDetail = (job) => {
    setSelectedJob(job);
    setUpdateText('');
    updatePhotos.reset();
    setDetailOpen(true);
  };

  const closeDetail = () => {
    setDetailOpen(false);
    setSelectedJob(null);
  };

  const handleAccept = async (job) => {
    try {
      await acceptMaintenanceJob(job.id);
      showToast('Job accepted');
    } catch (err) {
      console.error(err);
      showToast('Failed to accept job');
    }
  };

  const handleComplete = async () => {
    if (!selectedJob) return;
    try {
      await completeMaintenanceJob(selectedJob.id);
      showToast('Job marked as completed');
    } catch (err) {
      console.error(err);
      showToast('Failed to complete job');
    }
  };

  const openEdit = () => {
    if (!selectedJob) return;
    setEditJob({
      title: selectedJob.title || '',
      description: selectedJob.description || '',
      location: selectedJob.location || '',
      priority: selectedJob.priority || 'normal',
    });
    setEditOpen(true);
  };

  const handleEdit = async () => {
    if (!editJob.title.trim()) { showToast('Title is required'); return; }
    setSaving(true);
    try {
      await updateMaintenanceJob(selectedJob.id, {
        title: editJob.title.trim(),
        description: editJob.description.trim(),
        location: editJob.location.trim(),
        priority: editJob.priority,
      });
      setEditOpen(false);
      showToast('Job updated');
    } catch (err) {
      console.error(err);
      showToast('Failed to update job');
    } finally {
      setSaving(false);
    }
  };

  const openDelete = (job) => {
    setJobToDelete(job);
    setDeleteOpen(true);
  };

  const confirmDelete = async () => {
    if (!jobToDelete) return;
    setDeleting(true);
    try {
      await deleteMaintenanceJob(jobToDelete.id);
      setDeleteOpen(false);
      setJobToDelete(null);
      if (detailOpen) closeDetail();
      showToast('Job deleted');
    } catch (err) {
      console.error(err);
      showToast('Failed to delete job');
    } finally {
      setDeleting(false);
    }
  };

  const handleAddUpdate = async () => {
    if (!updateText.trim() && updatePhotos.files.length === 0) {
      showToast('Enter a message or attach a photo');
      return;
    }
    setSubmitting(true);
    try {
      let photoUrls = [];
      if (updatePhotos.files.length > 0) {
        photoUrls = await uploadPhotos(selectedJob.id, `updates/${Date.now()}`, updatePhotos.files);
      }
      await addJobUpdate(selectedJob.id, updateText.trim(), photoUrls);
      setUpdateText('');
      updatePhotos.reset();
      showToast('Update added');
    } catch (err) {
      console.error(err);
      showToast('Failed to add update');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Styles ────────────────────────────────────────────────────────────────

  const filterBtn = (key) => ({
    padding: '8px 16px',
    borderRadius: 999,
    border: '1px solid rgba(0,0,0,.22)',
    background: filter === key ? '#000' : '#fff',
    color: filter === key ? '#fff' : '#000',
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    flexShrink: 0,
    fontSize: 14,
  });

  const fieldStyle = { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 };
  const inputStyle = { width: '100%', padding: '12px 14px', borderRadius: 12, border: '1px solid rgba(0,0,0,.15)', fontSize: 15, background: '#fff' };
  const labelStyle = { fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 };

  // ─── Render ────────────────────────────────────────────────────────────────

  const detailJob = selectedJob;
  const detailPc = detailJob ? (PRIORITY_CONFIG[detailJob.priority] || PRIORITY_CONFIG.normal) : null;
  const detailSc = detailJob ? (STATUS_CONFIG[detailJob.status] || STATUS_CONFIG.open) : null;
  const sortedUpdates = detailJob ? [...(detailJob.updates || [])].sort((a, b) => b.timestamp - a.timestamp) : [];

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '8px 0' }}>

      {/* ── Page header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Maintenance Jobs</h2>
        <button className="btn" style={{ fontSize: 14 }} onClick={openCreate}>+ New Job</button>
      </div>

      {/* ── Filter pills ── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, overflowX: 'auto', paddingBottom: 4 }}>
        {FILTERS.map(f => {
          const count = f.key === 'all' ? jobs.length : jobs.filter(j => j.status === f.key).length;
          return (
            <button key={f.key} style={filterBtn(f.key)} onClick={() => setFilter(f.key)}>
              {f.label} <span style={{ opacity: 0.6, fontWeight: 400 }}>({count})</span>
            </button>
          );
        })}
      </div>

      {/* ── Job cards ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {filteredJobs.length === 0 ? (
          <div className="card pad" style={{ color: 'var(--muted)', textAlign: 'center', padding: 32 }}>
            No {filter === 'all' ? '' : filter + ' '}jobs found
          </div>
        ) : (
          filteredJobs.map(job => (
            <JobCard
              key={job.id}
              job={job}
              onView={openDetail}
              onAccept={handleAccept}
              currentUsername={currentUsername}
            />
          ))
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          CREATE MODAL
      ════════════════════════════════════════════════════════════════════════ */}
      <Modal open={createOpen} title="New Maintenance Job" onClose={() => setCreateOpen(false)}>
        <div style={{ maxHeight: '75vh', overflowY: 'auto', paddingRight: 4 }}>

          <div style={fieldStyle}>
            <label style={labelStyle}>Title *</label>
            <input
              style={inputStyle}
              placeholder="Brief description of the issue"
              value={newJob.title}
              maxLength={200}
              onChange={e => setNewJob(p => ({ ...p, title: e.target.value }))}
            />
          </div>

          <div style={fieldStyle}>
            <label style={labelStyle}>Location / Room</label>
            <input
              style={inputStyle}
              placeholder="e.g. Room 412, Level 3 Lobby"
              value={newJob.location}
              maxLength={100}
              onChange={e => setNewJob(p => ({ ...p, location: e.target.value }))}
            />
          </div>

          <div style={fieldStyle}>
            <label style={labelStyle}>Priority</label>
            <select
              style={{ ...inputStyle, cursor: 'pointer' }}
              value={newJob.priority}
              onChange={e => setNewJob(p => ({ ...p, priority: e.target.value }))}
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>

          <div style={fieldStyle}>
            <label style={labelStyle}>Description</label>
            <textarea
              style={{ ...inputStyle, minHeight: 90, resize: 'vertical' }}
              placeholder="Additional details about the job..."
              value={newJob.description}
              maxLength={1000}
              onChange={e => setNewJob(p => ({ ...p, description: e.target.value }))}
            />
          </div>

          <div style={{ ...fieldStyle, marginBottom: 20 }}>
            <label style={labelStyle}>Photos</label>
            <PhotoUploadRow photoState={createPhotos} label="Add Photos" />
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button className="btn secondary" onClick={() => setCreateOpen(false)}>Cancel</button>
            <button className="btn" onClick={handleCreate} disabled={creating}>
              {creating ? 'Creating…' : 'Create Job'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ═══════════════════════════════════════════════════════════════════════
          DETAIL MODAL
      ════════════════════════════════════════════════════════════════════════ */}
      {detailJob && (
        <Modal open={detailOpen} title={detailJob.title} onClose={closeDetail}>
          <div style={{ maxHeight: '80vh', overflowY: 'auto', paddingRight: 4 }}>

            {/* Status / priority row */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
              <Pill label={detailPc.label} color={detailPc.color} bg={detailPc.bg} />
              <Pill label={detailSc.label} color={detailSc.color} bg={detailSc.bg} />
              {detailJob.location && (
                <span style={{ fontSize: 13, color: 'var(--muted)', display: 'flex', alignItems: 'center' }}>
                  📍 {detailJob.location}
                </span>
              )}
            </div>

            {/* Meta */}
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12, lineHeight: 1.7 }}>
              <span>Logged by <strong>{detailJob.createdBy}</strong> · {timeAgo(detailJob.createdAtMs)}</span>
              {detailJob.acceptedBy && (
                <><br /><span>Accepted by <strong>{detailJob.acceptedBy}</strong> · {timeAgo(detailJob.acceptedAtMs)}</span></>
              )}
              {detailJob.completedBy && (
                <><br /><span>Completed by <strong>{detailJob.completedBy}</strong> · {timeAgo(detailJob.completedAtMs)}</span></>
              )}
            </div>

            {/* Description */}
            {detailJob.description && (
              <div style={{ marginBottom: 14, fontSize: 15, lineHeight: 1.6 }}>{detailJob.description}</div>
            )}

            {/* Photos */}
            {(detailJob.photoUrls || []).length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={labelStyle}>Photos</div>
                <PhotoStrip
                  urls={detailJob.photoUrls}
                  onRemove={null}
                />
              </div>
            )}

            {/* Action buttons */}
            {detailJob.status !== 'completed' && (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
                {detailJob.status === 'open' && (
                  <button className="btn" onClick={() => handleAccept(detailJob)}>✓ Accept Job</button>
                )}
                <button className="btn" onClick={handleComplete}>✓ Mark Complete</button>
                <button className="btn secondary" onClick={openEdit}>Edit</button>
                <button className="btn secondary" style={{ marginLeft: 'auto', color: '#c93030', borderColor: '#c93030' }} onClick={() => openDelete(detailJob)}>Delete</button>
              </div>
            )}
            {detailJob.status === 'completed' && (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
                <button className="btn secondary" onClick={openEdit}>Edit</button>
                <button className="btn secondary" style={{ marginLeft: 'auto', color: '#c93030', borderColor: '#c93030' }} onClick={() => openDelete(detailJob)}>Delete</button>
              </div>
            )}

            {/* ── Add Update ── */}
            {detailJob.status !== 'completed' && (
              <div style={{ background: '#f8f8f8', borderRadius: 12, padding: 14, marginBottom: 20 }}>
                <div style={{ ...labelStyle, marginBottom: 8 }}>Add Update</div>
                <textarea
                  style={{ ...inputStyle, minHeight: 70, resize: 'vertical', marginBottom: 10 }}
                  placeholder="Describe what was done or found…"
                  value={updateText}
                  onChange={e => setUpdateText(e.target.value)}
                  maxLength={1000}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
                  <PhotoUploadRow photoState={updatePhotos} label="Attach Photo" />
                  <button className="btn" style={{ flexShrink: 0 }} onClick={handleAddUpdate} disabled={submitting}>
                    {submitting ? 'Saving…' : 'Submit Update'}
                  </button>
                </div>
              </div>
            )}

            {/* ── Updates thread ── */}
            {sortedUpdates.length > 0 && (
              <div>
                <div style={{ ...labelStyle, marginBottom: 10 }}>Updates ({sortedUpdates.length})</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {sortedUpdates.map((u, i) => (
                    <div key={i} style={{ background: '#fff', border: '1px solid rgba(0,0,0,.1)', borderRadius: 12, padding: '12px 14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <strong style={{ fontSize: 13 }}>{u.user}</strong>
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{timeAgo(u.timestamp)}</span>
                      </div>
                      {u.text && <p style={{ margin: '0 0 8px 0', fontSize: 14, lineHeight: 1.5 }}>{u.text}</p>}
                      {(u.photoUrls || []).length > 0 && (
                        <PhotoStrip urls={u.photoUrls} onRemove={null} />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        </Modal>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          EDIT MODAL
      ════════════════════════════════════════════════════════════════════════ */}
      <Modal open={editOpen} title="Edit Job" onClose={() => setEditOpen(false)}>
        <div style={{ maxHeight: '75vh', overflowY: 'auto', paddingRight: 4 }}>

          <div style={fieldStyle}>
            <label style={labelStyle}>Title *</label>
            <input
              style={inputStyle}
              value={editJob.title}
              maxLength={200}
              onChange={e => setEditJob(p => ({ ...p, title: e.target.value }))}
            />
          </div>

          <div style={fieldStyle}>
            <label style={labelStyle}>Location / Room</label>
            <input
              style={inputStyle}
              value={editJob.location}
              maxLength={100}
              onChange={e => setEditJob(p => ({ ...p, location: e.target.value }))}
            />
          </div>

          <div style={fieldStyle}>
            <label style={labelStyle}>Priority</label>
            <select
              style={{ ...inputStyle, cursor: 'pointer' }}
              value={editJob.priority}
              onChange={e => setEditJob(p => ({ ...p, priority: e.target.value }))}
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>

          <div style={{ ...fieldStyle, marginBottom: 20 }}>
            <label style={labelStyle}>Description</label>
            <textarea
              style={{ ...inputStyle, minHeight: 90, resize: 'vertical' }}
              value={editJob.description}
              maxLength={1000}
              onChange={e => setEditJob(p => ({ ...p, description: e.target.value }))}
            />
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button className="btn secondary" onClick={() => setEditOpen(false)}>Cancel</button>
            <button className="btn" onClick={handleEdit} disabled={saving}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ═══════════════════════════════════════════════════════════════════════
          DELETE CONFIRM MODAL
      ════════════════════════════════════════════════════════════════════════ */}
      <Modal open={deleteOpen} title="Delete Job" onClose={() => setDeleteOpen(false)}>
        <p style={{ margin: '8px 0 20px 0' }}>
          Are you sure you want to delete <strong>"{jobToDelete?.title}"</strong>? This cannot be undone.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn secondary" onClick={() => setDeleteOpen(false)}>Cancel</button>
          <button
            className="btn"
            style={{ background: '#c93030', borderColor: '#c93030' }}
            onClick={confirmDelete}
            disabled={deleting}
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </Modal>

    </div>
  );
}
