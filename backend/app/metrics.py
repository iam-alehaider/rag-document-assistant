from prometheus_client import Counter, Histogram

RAG_QUERY_COUNT = Counter("rag_query_total", "Total number of RAG chat queries")
RAG_QUERY_LATENCY = Histogram("rag_query_latency_seconds", "Latency of RAG chat queries")
DOCUMENT_UPLOAD_COUNT = Counter("rag_document_upload_total", "Total documents ingested")
