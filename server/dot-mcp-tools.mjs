/** Generated from docs/dot-worker-openapi.json. Runtime-safe without loading docs files. */
export const DOT_MCP_TOOLS = Object.freeze([
  {
    "name": "workspace_worker_identity",
    "title": "Read pre-approved Workspace worker identity; no execution",
    "description": "Read pre-approved Workspace worker identity; no execution. Public-only Workspace task. No implied authority to send emails, charge an account, or access private RFQs.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "openWorldHint": false,
      "idempotentHint": true
    }
  },
  {
    "name": "workspace_worker_inbox",
    "title": "List scoped public task references without private context",
    "description": "List scoped public task references without private context. Public-only Workspace task. No implied authority to send emails, charge an account, or access private RFQs.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "openWorldHint": false,
      "idempotentHint": true
    }
  },
  {
    "name": "workspace_worker_read_task",
    "title": "Read original authorized public task",
    "description": "Read original authorized public task. Public-only Workspace task. No implied authority to send emails, charge an account, or access private RFQs.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "taskRef": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        }
      },
      "required": [
        "taskRef"
      ],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "openWorldHint": false,
      "idempotentHint": true
    }
  },
  {
    "name": "workspace_worker_claim_task",
    "title": "Atomically claim one task under an original fenced lease",
    "description": "Atomically claim one task under an original fenced lease. Public-only Workspace task. No implied authority to send emails, charge an account, or access private RFQs.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "taskRef": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "requestId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        }
      },
      "required": [
        "taskRef",
        "requestId"
      ],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "openWorldHint": false,
      "idempotentHint": false
    }
  },
  {
    "name": "workspace_worker_status",
    "title": "Read cancellation and execution authority",
    "description": "Read cancellation and execution authority. Public-only Workspace task. No implied authority to send emails, charge an account, or access private RFQs.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "taskRef": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        }
      },
      "required": [
        "taskRef"
      ],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "openWorldHint": false,
      "idempotentHint": true
    }
  },
  {
    "name": "workspace_worker_heartbeat",
    "title": "Renew the existing original attempt lease",
    "description": "Renew the existing original attempt lease. Public-only Workspace task. No implied authority to send emails, charge an account, or access private RFQs.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "taskRef": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "attemptId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "fence": {
          "type": "integer",
          "minimum": 1
        },
        "requestId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        }
      },
      "required": [
        "taskRef",
        "attemptId",
        "fence",
        "requestId"
      ],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "openWorldHint": false,
      "idempotentHint": false
    }
  },
  {
    "name": "workspace_worker_upload_file",
    "title": "Save exact source-backed artifact bytes from native tools",
    "description": "Save exact source-backed artifact bytes from native tools. Public-only Workspace task. No implied authority to send emails, charge an account, or access private RFQs.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "taskRef": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "attemptId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "fence": {
          "type": "integer",
          "minimum": 1
        },
        "uploadId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "filename": {
          "type": "string",
          "maxLength": 160
        },
        "base64": {
          "type": "string",
          "maxLength": 1398104
        },
        "sha256": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        }
      },
      "required": [
        "taskRef",
        "attemptId",
        "fence",
        "uploadId",
        "filename",
        "base64",
        "sha256"
      ],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "openWorldHint": false,
      "idempotentHint": false
    }
  },
  {
    "name": "workspace_worker_submit_result",
    "title": "Report original Dot research sources and tool receipt references after file upload",
    "description": "Report original Dot research sources and tool receipt references after file upload. Public-only Workspace task. No implied authority to send emails, charge an account, or access private RFQs.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "taskRef": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "attemptId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "fence": {
          "type": "integer",
          "minimum": 1
        },
        "requestId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "summary": {
          "type": "string",
          "minLength": 1,
          "maxLength": 8000
        },
        "sources": {
          "type": "array",
          "minItems": 1,
          "maxItems": 20,
          "items": {
            "type": "string",
            "maxLength": 2048
          }
        },
        "toolEvidence": {
          "type": "array",
          "minItems": 1,
          "maxItems": 20,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "tool": {
                "type": "string",
                "minLength": 1,
                "maxLength": 128
              },
              "receiptId": {
                "type": "string",
                "minLength": 1,
                "maxLength": 128
              }
            },
            "required": [
              "tool",
              "receiptId"
            ]
          }
        }
      },
      "required": [
        "taskRef",
        "attemptId",
        "fence",
        "requestId",
        "summary",
        "sources",
        "toolEvidence"
      ],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "openWorldHint": false,
      "idempotentHint": false
    }
  },
  {
    "name": "workspace_worker_report_blocked",
    "title": "Report original attempt blocker; do not reopen another lease",
    "description": "Report original attempt blocker; do not reopen another lease. Public-only Workspace task. No implied authority to send emails, charge an account, or access private RFQs.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "taskRef": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "attemptId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "fence": {
          "type": "integer",
          "minimum": 1
        },
        "requestId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "message": {
          "type": "string",
          "minLength": 1,
          "maxLength": 2000
        }
      },
      "required": [
        "taskRef",
        "attemptId",
        "fence",
        "requestId",
        "message"
      ],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "openWorldHint": false,
      "idempotentHint": false
    }
  },
  {
    "name": "workspace_worker_confirm_stop",
    "title": "Confirm that the original attempt has actually stopped",
    "description": "Confirm that the original attempt has actually stopped. Public-only Workspace task. No implied authority to send emails, charge an account, or access private RFQs.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "taskRef": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "attemptId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "fence": {
          "type": "integer",
          "minimum": 1
        },
        "requestId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        }
      },
      "required": [
        "taskRef",
        "attemptId",
        "fence",
        "requestId"
      ],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "openWorldHint": false,
      "idempotentHint": false
    }
  },
  {
    "name": "workspace_worker_ack_event",
    "title": "Acknowledge a dot event without granting execution authority",
    "description": "Acknowledge a dot event without granting execution authority. Public-only Workspace task. No implied authority to send emails, charge an account, or access private RFQs.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "taskRef": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "eventId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        }
      },
      "required": [
        "taskRef",
        "eventId"
      ],
      "additionalProperties": false
    },
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "openWorldHint": false,
      "idempotentHint": true
    }
  }
]);
