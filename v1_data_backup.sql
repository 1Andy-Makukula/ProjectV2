SET session_replication_role = replica;

--
-- PostgreSQL database dump
--

-- \restrict 4YbEEGv73Ow0wcsOIcSivtdQgExHw5p2zJa8886EFi0JM8fS0h2jrZ9RzSW2RSk

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: audit_log_entries; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: custom_oauth_providers; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: flow_state; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: users; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

INSERT INTO "auth"."users" ("instance_id", "id", "aud", "role", "email", "encrypted_password", "email_confirmed_at", "invited_at", "confirmation_token", "confirmation_sent_at", "recovery_token", "recovery_sent_at", "email_change_token_new", "email_change", "email_change_sent_at", "last_sign_in_at", "raw_app_meta_data", "raw_user_meta_data", "is_super_admin", "created_at", "updated_at", "phone", "phone_confirmed_at", "phone_change", "phone_change_token", "phone_change_sent_at", "email_change_token_current", "email_change_confirm_status", "banned_until", "reauthentication_token", "reauthentication_sent_at", "is_sso_user", "deleted_at", "is_anonymous") VALUES
	('00000000-0000-0000-0000-000000000000', 'cb8ea1dc-58da-4ffa-bb5f-0b0e4f77bb19', 'authenticated', 'authenticated', 'nana@gmail.com', '$2a$10$UrIXqoTfdW0shd5Mm5C68uH5ajD3H64C/1BWfMr.mRj2p9Nh0Jdxa', '2026-05-28 11:22:52.262655+00', NULL, '', NULL, '', NULL, '', '', NULL, '2026-05-28 11:58:43.221482+00', '{"provider": "email", "providers": ["email"]}', '{"sub": "cb8ea1dc-58da-4ffa-bb5f-0b0e4f77bb19", "name": "Namakau Mithi", "email": "nana@gmail.com", "phone": "+260973575666", "email_verified": true, "phone_verified": false}', NULL, '2026-05-28 11:22:52.226141+00', '2026-05-28 11:58:43.223639+00', NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false),
	('00000000-0000-0000-0000-000000000000', 'd82595d9-ddad-4919-b9f1-7384bb3a2ddd', 'authenticated', 'authenticated', 'andy.makukula@gmail.com', '$2a$10$/aFcEArfwLsvi5AifiZtIubEGZXwaqb8rz9X/4nHY.F2v08vTgVlG', '2026-05-27 18:08:01.23037+00', NULL, '', NULL, '', NULL, '', '', NULL, '2026-05-29 07:29:32.507252+00', '{"provider": "email", "providers": ["email"]}', '{"sub": "d82595d9-ddad-4919-b9f1-7384bb3a2ddd", "name": "Ndabane Makukula", "email": "andy.makukula@gmail.com", "phone": "+260973575666", "email_verified": true, "phone_verified": false}', NULL, '2026-05-27 18:08:01.183381+00', '2026-05-30 10:41:14.258095+00', NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false),
	('00000000-0000-0000-0000-000000000000', 'b6dbc34c-67cf-4578-86b2-464f781f5362', 'authenticated', 'authenticated', 'admin@gmail.com', '$2a$10$UbJdU8TZaBQdFGqlFzlTVeMOqYtaemn7/MDKuYcloATX7ZAaZGr4m', '2026-05-28 11:54:43.117413+00', NULL, '', NULL, '', NULL, '', '', NULL, '2026-05-30 10:42:44.176485+00', '{"provider": "email", "providers": ["email"]}', '{"sub": "b6dbc34c-67cf-4578-86b2-464f781f5362", "name": "Ndabane Makukula", "email": "admin@gmail.com", "phone": "+260973575666", "email_verified": true, "phone_verified": false}', NULL, '2026-05-28 11:54:43.080848+00', '2026-05-30 11:46:55.161448+00', NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false);


--
-- Data for Name: identities; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

INSERT INTO "auth"."identities" ("provider_id", "user_id", "identity_data", "provider", "last_sign_in_at", "created_at", "updated_at", "id") VALUES
	('d82595d9-ddad-4919-b9f1-7384bb3a2ddd', 'd82595d9-ddad-4919-b9f1-7384bb3a2ddd', '{"sub": "d82595d9-ddad-4919-b9f1-7384bb3a2ddd", "name": "Ndabane Makukula", "email": "andy.makukula@gmail.com", "phone": "+260973575666", "email_verified": false, "phone_verified": false}', 'email', '2026-05-27 18:08:01.225943+00', '2026-05-27 18:08:01.225994+00', '2026-05-27 18:08:01.225994+00', 'f7525296-9ea6-4c27-8d51-90cc65dfdd9b'),
	('cb8ea1dc-58da-4ffa-bb5f-0b0e4f77bb19', 'cb8ea1dc-58da-4ffa-bb5f-0b0e4f77bb19', '{"sub": "cb8ea1dc-58da-4ffa-bb5f-0b0e4f77bb19", "name": "Namakau Mithi", "email": "nana@gmail.com", "phone": "+260973575666", "email_verified": false, "phone_verified": false}', 'email', '2026-05-28 11:22:52.255602+00', '2026-05-28 11:22:52.255649+00', '2026-05-28 11:22:52.255649+00', '5292b042-775f-4413-8fde-d4f871f08680'),
	('b6dbc34c-67cf-4578-86b2-464f781f5362', 'b6dbc34c-67cf-4578-86b2-464f781f5362', '{"sub": "b6dbc34c-67cf-4578-86b2-464f781f5362", "name": "Ndabane Makukula", "email": "admin@gmail.com", "phone": "+260973575666", "email_verified": false, "phone_verified": false}', 'email', '2026-05-28 11:54:43.1088+00', '2026-05-28 11:54:43.108845+00', '2026-05-28 11:54:43.108845+00', 'a9864ae3-1788-44cf-97dc-898598db76d7');


--
-- Data for Name: instances; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: oauth_clients; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: sessions; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

INSERT INTO "auth"."sessions" ("id", "user_id", "created_at", "updated_at", "factor_id", "aal", "not_after", "refreshed_at", "user_agent", "ip", "tag", "oauth_client_id", "refresh_token_hmac_key", "refresh_token_counter", "scopes") VALUES
	('29f223f5-0dda-474a-8626-9eb40ce87370', 'b6dbc34c-67cf-4578-86b2-464f781f5362', '2026-05-30 10:42:44.177743+00', '2026-05-30 11:46:55.171992+00', NULL, 'aal1', NULL, '2026-05-30 11:46:55.171861', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36', '102.147.77.151', NULL, NULL, NULL, NULL, NULL);


--
-- Data for Name: mfa_amr_claims; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

INSERT INTO "auth"."mfa_amr_claims" ("session_id", "created_at", "updated_at", "authentication_method", "id") VALUES
	('29f223f5-0dda-474a-8626-9eb40ce87370', '2026-05-30 10:42:44.205174+00', '2026-05-30 10:42:44.205174+00', 'password', 'b7304bdc-1bc9-4a92-909d-262706fe2d44');


--
-- Data for Name: mfa_factors; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: mfa_challenges; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: oauth_authorizations; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: oauth_client_states; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: oauth_consents; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: one_time_tokens; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: refresh_tokens; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

INSERT INTO "auth"."refresh_tokens" ("instance_id", "id", "token", "user_id", "revoked", "created_at", "updated_at", "parent", "session_id") VALUES
	('00000000-0000-0000-0000-000000000000', 52, 's7jfcoiakzjv', 'b6dbc34c-67cf-4578-86b2-464f781f5362', true, '2026-05-30 10:42:44.193629+00', '2026-05-30 11:46:55.138351+00', NULL, '29f223f5-0dda-474a-8626-9eb40ce87370'),
	('00000000-0000-0000-0000-000000000000', 53, 'lqednxokq53k', 'b6dbc34c-67cf-4578-86b2-464f781f5362', false, '2026-05-30 11:46:55.152737+00', '2026-05-30 11:46:55.152737+00', 's7jfcoiakzjv', '29f223f5-0dda-474a-8626-9eb40ce87370');


--
-- Data for Name: sso_providers; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: saml_providers; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: saml_relay_states; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: sso_domains; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: webauthn_challenges; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: webauthn_credentials; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--



--
-- Data for Name: categories; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."users" ("id", "name", "email", "phone", "role", "created_at") VALUES
	('cb8ea1dc-58da-4ffa-bb5f-0b0e4f77bb19', 'Namakau Mithi', 'nana@gmail.com', '+260973575666', 'merchant', '2026-05-28 11:22:52.225204+00'),
	('d82595d9-ddad-4919-b9f1-7384bb3a2ddd', 'Ndabane Makukula', 'andy.makukula@gmail.com', '+260973575666', 'sender', '2026-05-27 18:08:01.181898+00'),
	('b6dbc34c-67cf-4578-86b2-464f781f5362', 'Ndabane Makukula', 'admin@gmail.com', '+260973575666', 'admin', '2026-05-28 11:54:43.080535+00');


--
-- Data for Name: shops; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."shops" ("id", "owner_id", "name", "location", "address", "payout_method", "payout_details", "is_active", "created_at", "logo_url") VALUES
	('97288d85-955a-4ce2-b965-61a7df995937', 'b6dbc34c-67cf-4578-86b2-464f781f5362', 'NANA''S CORNER SHOP', 'LUSAKA, NORTHMED', 'NORTHMED MARKET', 'airtel', '+260973575666', true, '2026-05-30 10:44:21.973731+00', 'https://mbjbrdhpjgfhhycijodz.supabase.co/storage/v1/object/public/storefront-assets/shop-logos/shop-1780137849379.jpg'),
	('94d0d25b-6ca5-4f3f-a0d7-3ebdc50b3b9f', 'b6dbc34c-67cf-4578-86b2-464f781f5362', 'SIBO''S BAKERY SHOP', 'LUSAKA, NGWERERE', 'LUSAKA, NEAR VEGELAND', 'airtel', '+260973575666', true, '2026-05-30 10:49:16.599508+00', 'https://mbjbrdhpjgfhhycijodz.supabase.co/storage/v1/object/public/storefront-assets/shop-logos/shop-1780138150340.jpg');


--
-- Data for Name: items; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: kithly_wallets; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: marketing_campaigns; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: merchant_shops; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: transactions; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: shop_orders; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: order_items; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: payment_webhook_idempotency; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: payout_ledger; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: transaction_events; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: buckets; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--

INSERT INTO "storage"."buckets" ("id", "name", "owner", "created_at", "updated_at", "public", "avif_autodetection", "file_size_limit", "allowed_mime_types", "owner_id", "type") VALUES
	('storefront-assets', 'storefront-assets', NULL, '2026-05-28 14:05:47.500441+00', '2026-05-28 14:05:47.500441+00', true, false, NULL, NULL, NULL, 'STANDARD');


--
-- Data for Name: buckets_analytics; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Data for Name: buckets_vectors; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Data for Name: objects; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--

INSERT INTO "storage"."objects" ("id", "bucket_id", "name", "owner", "created_at", "updated_at", "last_accessed_at", "metadata", "version", "owner_id", "user_metadata") VALUES
	('2497f20b-a9ec-4506-929b-6a3189017724', 'storefront-assets', 'shop-logos/.emptyFolderPlaceholder', NULL, '2026-05-30 10:42:28.971899+00', '2026-05-30 10:42:28.971899+00', '2026-05-30 10:42:28.971899+00', '{"eTag": "\"d41d8cd98f00b204e9800998ecf8427e\"", "size": 0, "mimetype": "application/octet-stream", "cacheControl": "max-age=3600", "lastModified": "2026-05-30T10:42:28.971Z", "contentLength": 0, "httpStatusCode": 200}', '1e4d30e1-d649-4b15-b0a8-64361b7a1aef', NULL, '{}'),
	('4b1243ee-dfc1-457b-ae0f-15e34218bdae', 'storefront-assets', 'shop-logos/shop-1780137849379.jpg', 'b6dbc34c-67cf-4578-86b2-464f781f5362', '2026-05-30 10:44:19.906047+00', '2026-05-30 10:44:19.906047+00', '2026-05-30 10:44:19.906047+00', '{"eTag": "\"9fb7dcb6fe2e96dcf5ac3059f9e0f677\"", "size": 3591286, "mimetype": "image/jpeg", "cacheControl": "max-age=3600", "lastModified": "2026-05-30T10:44:20.000Z", "contentLength": 3591286, "httpStatusCode": 200}', '9e2803e5-2ba0-4116-9835-550780efe091', 'b6dbc34c-67cf-4578-86b2-464f781f5362', '{}'),
	('042817f4-ce07-4171-94ea-0799954d176f', 'storefront-assets', 'shop-logos/shop-1780138150340.jpg', 'b6dbc34c-67cf-4578-86b2-464f781f5362', '2026-05-30 10:49:15.520503+00', '2026-05-30 10:49:15.520503+00', '2026-05-30 10:49:15.520503+00', '{"eTag": "\"3ebdb45bc47eb2d87970d20eb1a10ab9\"", "size": 664477, "mimetype": "image/jpeg", "cacheControl": "max-age=3600", "lastModified": "2026-05-30T10:49:16.000Z", "contentLength": 664477, "httpStatusCode": 200}', '2d5030ec-9e9d-4dd2-a620-99e5425faf67', 'b6dbc34c-67cf-4578-86b2-464f781f5362', '{}');


--
-- Data for Name: s3_multipart_uploads; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Data for Name: s3_multipart_uploads_parts; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Data for Name: vector_indexes; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--



--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE SET; Schema: auth; Owner: supabase_auth_admin
--

SELECT pg_catalog.setval('"auth"."refresh_tokens_id_seq"', 53, true);


--
-- PostgreSQL database dump complete
--

-- \unrestrict 4YbEEGv73Ow0wcsOIcSivtdQgExHw5p2zJa8886EFi0JM8fS0h2jrZ9RzSW2RSk

RESET ALL;
