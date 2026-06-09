interface Props {
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/// Тематический диалог подтверждения (вместо системного window.confirm,
/// который требовал отдельного ACL-разрешения и не всегда работал).
export function ConfirmDialog({
  message,
  confirmLabel = "Удалить",
  onConfirm,
  onCancel,
}: Props) {
  return (
    <div className="overlay" onClick={onCancel}>
      <div
        className="modal confirm-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="confirm-text">{message}</p>
        <div className="modal-actions">
          <button className="btn ghost" onClick={onCancel}>
            Отмена
          </button>
          <button className="btn danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
