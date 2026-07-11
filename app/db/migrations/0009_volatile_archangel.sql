CREATE TABLE "embeddings" (
	"id" text PRIMARY KEY NOT NULL,
	"vehicle_id" text NOT NULL,
	"log_id" text,
	"document_id" text,
	"content" text NOT NULL,
	"model" text NOT NULL,
	"embedding" vector(768) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_log_id_logs_id_fk" FOREIGN KEY ("log_id") REFERENCES "public"."logs"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_document_id_vehicle_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."vehicle_documents"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "embeddings_log_idx" ON "embeddings" USING btree ("log_id");--> statement-breakpoint
CREATE UNIQUE INDEX "embeddings_document_idx" ON "embeddings" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "embeddings_vehicle_idx" ON "embeddings" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "embeddings_vector_idx" ON "embeddings" USING hnsw ("embedding" vector_cosine_ops);