--
-- PostgreSQL database dump
--

\restrict 4iOoGeR6IZMLffCj9hzFQRtbgh3ALeLLKrxlQi5K8DE3kVexHHBQ47o2OIeMbZY

-- Dumped from database version 18.4 (Debian 18.4-1.pgdg13+1)
-- Dumped by pg_dump version 18.4 (Debian 18.4-1.pgdg13+1)

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
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: rizkgin
--

SET SESSION AUTHORIZATION DEFAULT;

ALTER TABLE public.users DISABLE TRIGGER ALL;

COPY public.users (id, name, phone, email, address, email_verified, image, updated_at, created_at, deleted_at) FROM stdin;
v3xRwEF3SLnu7NmLTFLrv6Yq7bToRBhO	Pelanggan Offline	082222222222	rizkygin1@gmail.com	Jl. Contoh	f	avatar.png	2026-06-08 12:53:14.184+00	2026-06-08 12:53:14.184+00	\N
fsD8l2mMnLbEQ35CvZLkQYrR8pJz6WE0	owner_test	082222222222	rizkygin2@gmail.com	Jl. Contoh	f	avatar.png	2026-06-08 12:53:14.264+00	2026-06-08 12:53:14.264+00	\N
uoiuR0aAFVqw247968HuPM8TBTI1frEv	courier_test	082222222222	rizkygin3@gmail.com	Jl. Contoh	f	avatar.png	2026-06-08 12:53:14.348+00	2026-06-08 12:53:14.348+00	\N
ZWMPMbrCOcIIPjswKOmPy7F5ZgXDyOK4	Rizky Online	082222222222	rizkygin4@gmail.com	Jl. Contoh	f	avatar.png	2026-06-08 12:53:14.42+00	2026-06-08 12:53:14.42+00	\N
8vw0ltUCxfFLtMse1NeIYzGaMiBBRdoB	Admin	082222222222	rizkygin@gmail.com	Jl. Contoh	f	avatar.png	2026-06-10 08:12:39.487+00	2026-06-10 08:12:39.487+00	\N
80XRU86oAyLaCCxolvqrWgCr9N8cZSbx	Test Only	082222222222	test@gmail.com	Jl. Contoh	f	avatar.png	2026-06-14 03:04:14.796+00	2026-06-14 03:04:14.796+00	\N
KuVMtujRiDnRonYzER896L76xok0h2oi	Umak Tytys 	082222222222	umaktytys@gmail.com	Jl. Contoh	f	avatar.png	2026-06-16 04:17:37.155+00	2026-06-16 04:17:37.155+00	\N
kVDZUKZssWtg1pzt1T9jIxa0jqNc0ECo	Test	082222222222	test@tes.com	Jl. Contoh	f	avatar.png	2026-06-16 06:31:55.316+00	2026-06-16 06:31:55.316+00	\N
B6RgLVE59Jn2tXIQOi4l9FDOz9cQw6LA	asdf	082222222222	asdf@asdfasdf.com	Jl. Contoh	f	avatar.png	2026-06-16 07:01:49.45+00	2026-06-16 07:01:49.45+00	\N
gyGNgmGQm16NKS56RYtNySQYUW7m9p6N	Gojo satoru	082222222222	rahmadagus.64@gmail.com	Jl. Contoh	f	avatar.png	2026-06-16 07:22:34.259+00	2026-06-16 07:22:34.259+00	\N
cm2yqqjTzhVwsgTQg5VSWFL0Y3qIExGi	test only	082222222222	test@test.com	Jl. Contoh	f	avatar.png	2026-06-16 08:06:24.264+00	2026-06-16 08:06:24.264+00	\N
6d1yeaA1qll4OGgcSWT1OH3GUktid50s	Faruk ayatulah	082222222222	farukayatulah@gmail.com	Jl. Contoh	f	avatar.png	2026-06-16 08:23:59.188+00	2026-06-16 08:23:59.188+00	\N
dWghUf3GjdSri0FyozX8QWXsxetnL2y9	Test Only Again	082222222222	test2@gmail.com	Jl. Contoh	f	avatar.png	2026-06-16 11:14:09.689+00	2026-06-16 11:14:09.689+00	\N
6Q5tXyJuE3F9nS1O4gBqv1kMvAdGphUq	test ajaaah	082222222222	test@gmailts.co.id	Jl. Contoh	f	avatar.png	2026-06-17 13:34:46.12+00	2026-06-17 13:34:46.12+00	\N
x2d1feihutyjKLwow7NiL5BLsZiDfWiz	Insanur	082222222222	dwiqzahra@gmail.com	Jl. Contoh	f	avatar.png	2026-06-17 13:37:30.477+00	2026-06-17 13:37:30.477+00	\N
JOlWbhFPkzvAHqjDpdYNrCgfGlOtloIx	Nunur	082222222222	dwiqzahra47@gmail.com	Jl. Contoh	f	avatar.png	2026-06-17 13:39:40.325+00	2026-06-17 13:39:40.325+00	\N
\.


ALTER TABLE public.users ENABLE TRIGGER ALL;

--
-- Data for Name: account; Type: TABLE DATA; Schema: public; Owner: rizkgin
--

ALTER TABLE public.account DISABLE TRIGGER ALL;

COPY public.account (id, account_id, provider_id, user_id, access_token, refresh_token, id_token, access_token_expires_at, refresh_token_expires_at, scope, password, created_at, updated_at) FROM stdin;
ocqH65yDWEPQax5nM3blywvivMER0nP7	v3xRwEF3SLnu7NmLTFLrv6Yq7bToRBhO	credential	v3xRwEF3SLnu7NmLTFLrv6Yq7bToRBhO	\N	\N	\N	\N	\N	\N	5076b8fb3a9dd80d73c84b0c2cf3eddd:aabf7c833818805c9e57b4371a04933afff4f4f6a3da89fdf026a9bd495caf102d55e8d10588770edb5ca6da08b3e65d5f8c6a409368e5de46660e49d51e1645	2026-06-08 12:53:14.191+00	2026-06-08 12:53:14.191+00
Rfq842NQCJS8jE4UeOYEfc0Ku1vxWEcB	fsD8l2mMnLbEQ35CvZLkQYrR8pJz6WE0	credential	fsD8l2mMnLbEQ35CvZLkQYrR8pJz6WE0	\N	\N	\N	\N	\N	\N	f2ca1bbb776f6a722c216360aba5d911:80f7d0a4a8ce7dcb87b2abb2fef77c68effb4e700a055f1c9424a0000a32e46d89886bf8befd7970c0e3ff0f58279daff35cb48d8ea2041ae6e5992a2157afef	2026-06-08 12:53:14.268+00	2026-06-08 12:53:14.268+00
Ju2w2t1QMjEsgOAlsWMGDRRx7NTIovYq	uoiuR0aAFVqw247968HuPM8TBTI1frEv	credential	uoiuR0aAFVqw247968HuPM8TBTI1frEv	\N	\N	\N	\N	\N	\N	b63e4f53bfb71c0082c283e98c3790db:98307b3bf4e3cc8b9a45c1feb8a832b56bfd460c2df3d7e5ebc481b5b7ffc533578eb470d29aa0d5b7fb5686a1433f4ebfadc3606ef031437dfcf1c19d2eb643	2026-06-08 12:53:14.352+00	2026-06-08 12:53:14.352+00
cvx0oVVsROCr6gbUa8syWmOe6jKwnFSg	ZWMPMbrCOcIIPjswKOmPy7F5ZgXDyOK4	credential	ZWMPMbrCOcIIPjswKOmPy7F5ZgXDyOK4	\N	\N	\N	\N	\N	\N	3ca402dbc7f8454ee49cba15ce77c075:9a9bec00d24de487c0c2a13c1999d96bea109c26e6d7ab3beb0749e886c8d679cec2d771b28c6b12f07ce544e0594cef8b8a33595d7c1330ecaeb1d2993b6a6b	2026-06-08 12:53:14.424+00	2026-06-08 12:53:14.424+00
NhKYDHLEUUkfAolTMQOwWNEpcVat512z	8vw0ltUCxfFLtMse1NeIYzGaMiBBRdoB	credential	8vw0ltUCxfFLtMse1NeIYzGaMiBBRdoB	\N	\N	\N	\N	\N	\N	e6c6f84c92ff45ca6d083332253318cb:3f23576b0a092e9579a47934832468dfdaeecaff76c369913116ed67253a9bc31eb91326cf2702bc58e23d5322c0c718702ddd9f90d26b39b841f43c9ab9747e	2026-06-10 08:12:39.501+00	2026-06-10 08:12:39.501+00
jSXjhaqECkibMrFaQyfWReDBmGkEeNEK	80XRU86oAyLaCCxolvqrWgCr9N8cZSbx	credential	80XRU86oAyLaCCxolvqrWgCr9N8cZSbx	\N	\N	\N	\N	\N	\N	3dcd5890e5e20e4a154146533b1a5b56:9409a45417748e561debb4ff0eda612016d2a66c2cbf9b7080d7da1303803875d805f147624f89e99404941d6366219af0f2e42c297c0ef22577a8acfd1e1b50	2026-06-14 03:04:14.804+00	2026-06-14 03:04:14.804+00
2UHqpXOckdgW4H9cJiJqRPzv4YTaAQgD	KuVMtujRiDnRonYzER896L76xok0h2oi	credential	KuVMtujRiDnRonYzER896L76xok0h2oi	\N	\N	\N	\N	\N	\N	611f7e2f42bbf59791c1f4631bd45e18:0826fcbf1a84815cdf665f2282355568f7e6e13d540494dcd761bbbc33c81732faa526b801c34273e3252f0c94b5fa64a2e68125a64ce38b71f2e46dd19492f4	2026-06-16 04:17:37.163+00	2026-06-16 04:17:37.163+00
Z1jmXJkMCpYUWNctUgpDZ0G6leStpnKL	kVDZUKZssWtg1pzt1T9jIxa0jqNc0ECo	credential	kVDZUKZssWtg1pzt1T9jIxa0jqNc0ECo	\N	\N	\N	\N	\N	\N	b9712cd9e887160d78cde6966f0a731e:b081910aecbd4f4b5111cccd4604bb8ca9ff5cde5b05680fba0343602785befda7730d017e0526c6d0268c6d7fe8fac4c505f4ff9721c404a32058b4e15a284c	2026-06-16 06:31:55.327+00	2026-06-16 06:31:55.327+00
l3crWdH5qEdV7mYonnY5CfCMkhqaNZso	B6RgLVE59Jn2tXIQOi4l9FDOz9cQw6LA	credential	B6RgLVE59Jn2tXIQOi4l9FDOz9cQw6LA	\N	\N	\N	\N	\N	\N	ec8d155861326cd8df6fdeba41650fcb:ba26924925360206f2cb12d9f2dd613576162356bd04479f069d4d47eb8ee35da330566b0e875678976245b16ac6c19205092cfe275389c59ae32b39c8f95a2d	2026-06-16 07:01:49.481+00	2026-06-16 07:01:49.481+00
azopYbwCORzhlyJ6iHB5WAf0zdi3yuu6	gyGNgmGQm16NKS56RYtNySQYUW7m9p6N	credential	gyGNgmGQm16NKS56RYtNySQYUW7m9p6N	\N	\N	\N	\N	\N	\N	d096f7f90a8b04788a73cc35cca8a04e:ee5a670580ea7d10110ea2e1c4f82eb7e5369ae44106aa5107c1fc786d53e1b48a58e10f3f9cee95b582f47cfa57a1d7c4dc0ccd808cec5f1e0dd439e1751f09	2026-06-16 07:22:34.273+00	2026-06-16 07:22:34.273+00
mtBjgYNaDQOYj4A7JtAEVfFifw047ajA	cm2yqqjTzhVwsgTQg5VSWFL0Y3qIExGi	credential	cm2yqqjTzhVwsgTQg5VSWFL0Y3qIExGi	\N	\N	\N	\N	\N	\N	19bd656cd11403afa3c41132104497ba:6ea9709e94222a5614d9e824da31935528df14cbc4549418ea04f5a2ac8c67780a252a598220baf0f975ec17c4f9a8ad035d2909150c7c0e73292adf7a3ecb90	2026-06-16 08:06:24.278+00	2026-06-16 08:06:24.278+00
8aoVolLQlYb6XLp4xhdHMpSEqRki8CUI	6d1yeaA1qll4OGgcSWT1OH3GUktid50s	credential	6d1yeaA1qll4OGgcSWT1OH3GUktid50s	\N	\N	\N	\N	\N	\N	5aae6a0b313b5455d9b8222280a06a39:1548824a0d84ec4208e38fc48f92bd4daa16d59e883abe10074f6f1d1d1e39ebbe8dcdbeef960a0f5fd9d2715c341c8d0a06c96ca06bfb0cf808430c36521b53	2026-06-16 08:23:59.194+00	2026-06-16 08:23:59.194+00
4a8ITVqLabs5vY6Brz9lhAWek1ReSRll	dWghUf3GjdSri0FyozX8QWXsxetnL2y9	credential	dWghUf3GjdSri0FyozX8QWXsxetnL2y9	\N	\N	\N	\N	\N	\N	5380d9ac6e29aaeda2d1551cbfb11ec8:e0b492ddf172eaaeb188c67647068583dc10167b3854ebdcd28f6682a7c81c38a79f866727b30d03ec29d169c0589965bd576792375e4b1f1877c692565ab97e	2026-06-16 11:14:09.696+00	2026-06-16 11:14:09.696+00
7IOtVkwpOAHOJLbi68CJV6VNvnaeL0JB	6Q5tXyJuE3F9nS1O4gBqv1kMvAdGphUq	credential	6Q5tXyJuE3F9nS1O4gBqv1kMvAdGphUq	\N	\N	\N	\N	\N	\N	649278ced6f6c8f3fddf65fa887a4c27:16da7665ba15aa51040a497fea728e325bfbbbb6b2fc7a2be33c89ee2dfa936ee3487d043f4bdabb9a7c00ce14b2733c5f21e2649eb0f44f44da1ef75244d2da	2026-06-17 13:34:46.128+00	2026-06-17 13:34:46.128+00
ZezkBbxN42eDQFXjHCt8huWhLsP42iub	x2d1feihutyjKLwow7NiL5BLsZiDfWiz	credential	x2d1feihutyjKLwow7NiL5BLsZiDfWiz	\N	\N	\N	\N	\N	\N	940daf57a194b71f82afefd137140d13:192574f76529690e70b83740c5ae2eb881e63cabc8c7d31ce4f03243a47a667849b60f22eb8064d97da744f0c8c0893adaf2ed9394de3e6adf3a6e89fdd672ee	2026-06-17 13:37:30.483+00	2026-06-17 13:37:30.483+00
nYmFDu6dNhTLiQHSq22K14sMsD4aNlcb	JOlWbhFPkzvAHqjDpdYNrCgfGlOtloIx	credential	JOlWbhFPkzvAHqjDpdYNrCgfGlOtloIx	\N	\N	\N	\N	\N	\N	812e52c3186a249bd137a3b150df1611:0e9638a6ff2e1995983f8df6c9503b724546d38a67828b862e5a51d8753659ee1cb9257ed7127d4cb2f991c65e142b6c86f981d2de91bcc66bba587524b62cb2	2026-06-17 13:39:40.331+00	2026-06-17 13:39:40.331+00
\.


ALTER TABLE public.account ENABLE TRIGGER ALL;

--
-- Data for Name: admins; Type: TABLE DATA; Schema: public; Owner: rizkgin
--

ALTER TABLE public.admins DISABLE TRIGGER ALL;

COPY public.admins (id, user_id, name, email, updated_at, created_at, deleted_at) FROM stdin;
1	8vw0ltUCxfFLtMse1NeIYzGaMiBBRdoB	Admin	rizkygin@gmail.com	\N	2026-06-10 08:13:05.735096+00	\N
\.


ALTER TABLE public.admins ENABLE TRIGGER ALL;

--
-- Data for Name: cashInCategory; Type: TABLE DATA; Schema: public; Owner: rizkgin
--

ALTER TABLE public."cashInCategory" DISABLE TRIGGER ALL;

COPY public."cashInCategory" (id, category) FROM stdin;
1	Pinjaman keluarga/teman
11	Penjualan kendaraan operasional
5	Pinjaman bank
12	Penjualan mesin/peralatan
6	Komisi atau fee
14	Lain-lain
2	Tambahan setoran modal partner/investor
3	Modal pribadi owner
7	Dana hibah atau bantuan pemerintah
8	Uang muka/down payment dari customer
13	Penjualan stok lama/scrap
9	Penjualan produk/jasa
4	Pendapatan layanan tambahan
10	Pembayaran piutang pelanggan
\.


ALTER TABLE public."cashInCategory" ENABLE TRIGGER ALL;

--
-- Data for Name: cashInDetailTable; Type: TABLE DATA; Schema: public; Owner: rizkgin
--

ALTER TABLE public."cashInDetailTable" DISABLE TRIGGER ALL;

COPY public."cashInDetailTable" (id, category_id, money_amount, type, created_at) FROM stdin;
1	9	84000	cash	2026-06-09 04:04:20.103892
2	9	42000	cash	2026-06-09 04:33:26.338049
3	9	40000	cash	2026-06-12 04:31:16.860504
4	9	23000	cash	2026-06-16 04:07:58.740319
5	6	100000	cash	2026-06-10 17:00:00
6	9	40000	cash	2026-06-16 08:31:45.044845
7	9	170000	cash	2026-06-17 01:39:10.682211
8	6	20000	cash	2026-06-17 14:16:00.088
9	9	72500	cash	2026-06-18 04:45:03.058347
10	5	50000000	cash	2026-06-18 04:45:42.716
\.


ALTER TABLE public."cashInDetailTable" ENABLE TRIGGER ALL;

--
-- Data for Name: cashOutCategory; Type: TABLE DATA; Schema: public; Owner: rizkgin
--

ALTER TABLE public."cashOutCategory" DISABLE TRIGGER ALL;

COPY public."cashOutCategory" (id, category) FROM stdin;
2	Listrik, air, internet
7	Biaya admin marketplace
11	ATK dan perlengkapan kantor
18	Pembelian Mesin / Asset
17	Biaya Notaris atau badan hukum
1	Pembelian stok barang dagang
5	Pembelian bahan baku
6	Ongkos kirim
9	Biaya packaging
8	Transportasi operasional
12	Cicilan Pinjaman
14	Maintenance/perbaikan kecil
15	Prive Owner (Uang Owner yang dipakai sebelumnya)
16	Pengembalian modal investor
13	Pengeluaran Darurat
4	Sewa tempat
3	Gaji karyawan
19	BPJS Karyawan
10	Iklan/marketing
20	Lain-lain
\.


ALTER TABLE public."cashOutCategory" ENABLE TRIGGER ALL;

--
-- Data for Name: cashOutDetailTable; Type: TABLE DATA; Schema: public; Owner: rizkgin
--

ALTER TABLE public."cashOutDetailTable" DISABLE TRIGGER ALL;

COPY public."cashOutDetailTable" (id, category_id, money_amount, type, created_at) FROM stdin;
1	8	60000	cash	2026-06-16 04:09:01.83
2	5	50000	cash	2026-06-17 14:16:07.384
3	6	300000	cash	2026-06-18 04:46:02.769
\.


ALTER TABLE public."cashOutDetailTable" ENABLE TRIGGER ALL;

--
-- Data for Name: outlets; Type: TABLE DATA; Schema: public; Owner: rizkgin
--

ALTER TABLE public.outlets DISABLE TRIGGER ALL;

COPY public.outlets (id, name, address, lat, lon, phone, email, user_id, avatar, ratings, review_count, tags, features, is_open, updated_at, created_at, deleted_at) FROM stdin;
1	owner_test's Resto	Jakarta, Indonesia	-2.6802856778421478	111.6320825760843	08123456789	rizkygin2@gmail.com	fsD8l2mMnLbEQ35CvZLkQYrR8pJz6WE0	/avatars/avatar-1780975556567-449158710.webp	5.00	3	{Halal}	{drink,food}	t	\N	2026-06-08 12:53:14.273016+00	\N
4	Sheora	Meri Mojokerto Jawa timur	-3.3199	 114.5907	085708234134	farukayatulah@gmail.com	6d1yeaA1qll4OGgcSWT1OH3GUktid50s	avatar.png	5.00	0	{}	{mart}	t	\N	2026-06-16 08:25:21.682239+00	\N
3	Umak Tytys 	Jln bhayangkara pinang merah poros 1 RT.07	-3.3199	 114.5907	085856675012	umaktytys@gmail.com	KuVMtujRiDnRonYzER896L76xok0h2oi	avatar.png	5.00	0	{}	{food}	t	\N	2026-06-16 04:21:52.42854+00	\N
2	Kyan Corner	Jl HM Rafi'i	-3.3199	 114.5907	08222222222	tes@gmail.com	80XRU86oAyLaCCxolvqrWgCr9N8cZSbx	avatar.png	5.00	0	{}	{drink}	t	\N	2026-06-14 03:05:20.720565+00	\N
5	Pawon bu syah	Jl.poros pinang merah	-3.3199	 114.5907	081330740471	dwiqzahra47@gmail.com	JOlWbhFPkzvAHqjDpdYNrCgfGlOtloIx	avatar.png	5.00	0	{}	{food}	t	\N	2026-06-17 13:43:00.917655+00	\N
\.


ALTER TABLE public.outlets ENABLE TRIGGER ALL;

--
-- Data for Name: cashFlows; Type: TABLE DATA; Schema: public; Owner: rizkgin
--

ALTER TABLE public."cashFlows" DISABLE TRIGGER ALL;

COPY public."cashFlows" (id, outlet_id, cash_opname, cash_in_detail_id, cash_out_detail_id) FROM stdin;
1	1	cash	1	\N
2	1	cash	2	\N
3	1	cash	3	\N
4	1	cash	4	\N
5	1	cash	\N	1
6	1	cash	5	\N
7	4	cash	6	\N
8	3	cash	7	\N
9	1	cash	8	\N
10	1	cash	\N	2
11	1	cash	9	\N
12	1	cash	10	\N
13	1	cash	\N	3
\.


ALTER TABLE public."cashFlows" ENABLE TRIGGER ALL;

--
-- Data for Name: couriers; Type: TABLE DATA; Schema: public; Owner: rizkgin
--

ALTER TABLE public.couriers DISABLE TRIGGER ALL;

COPY public.couriers (id, user_id, avatar, vehicle_plate, vehicle_type, ratings, review_count, updated_at, created_at, deleted_at) FROM stdin;
1	uoiuR0aAFVqw247968HuPM8TBTI1frEv	avatar-courier.png	B 1234 CDE	motorcycle	2.25	12	\N	2026-06-08 12:53:14.356696+00	\N
37	cm2yqqjTzhVwsgTQg5VSWFL0Y3qIExGi	avatar-courier.png	KH 9898 JK	motorcycle	5.00	0	\N	2026-06-16 08:08:15.892157+00	\N
\.


ALTER TABLE public.couriers ENABLE TRIGGER ALL;

--
-- Data for Name: courier_sessions; Type: TABLE DATA; Schema: public; Owner: rizkgin
--

ALTER TABLE public.courier_sessions DISABLE TRIGGER ALL;

COPY public.courier_sessions (id, courier_id, started_at, ended_at) FROM stdin;
1	1	2026-06-09 04:14:42.819856+00	2026-06-12 03:53:54.328+00
2	1	2026-06-12 03:54:26.287022+00	2026-06-12 03:57:12.523+00
3	1	2026-06-12 03:57:21.393421+00	\N
4	37	2026-06-16 08:13:26.725299+00	2026-06-16 08:13:39.123+00
5	37	2026-06-16 08:13:42.761856+00	\N
\.


ALTER TABLE public.courier_sessions ENABLE TRIGGER ALL;

--
-- Data for Name: customers; Type: TABLE DATA; Schema: public; Owner: rizkgin
--

ALTER TABLE public.customers DISABLE TRIGGER ALL;

COPY public.customers (id, user_id, ratings, review_count, updated_at, created_at, deleted_at) FROM stdin;
2	ZWMPMbrCOcIIPjswKOmPy7F5ZgXDyOK4	5.00	2	\N	2026-06-08 12:53:14.428665+00	\N
1	v3xRwEF3SLnu7NmLTFLrv6Yq7bToRBhO	5.00	1	\N	2026-06-08 12:53:14.199888+00	\N
3	gyGNgmGQm16NKS56RYtNySQYUW7m9p6N	5.00	0	\N	2026-06-16 07:24:12.975467+00	\N
\.


ALTER TABLE public.customers ENABLE TRIGGER ALL;

--
-- Data for Name: locations; Type: TABLE DATA; Schema: public; Owner: rizkgin
--

ALTER TABLE public.locations DISABLE TRIGGER ALL;

COPY public.locations (id, user_id, label, address, lat, lon, note, is_default, updated_at, created_at, deleted_at) FROM stdin;
1	ZWMPMbrCOcIIPjswKOmPy7F5ZgXDyOK4	Rumah	Jl. Antar sari	-2.7294889557155577	111.6374333779042	Depan pagar kuning	t	\N	2026-06-09 03:45:59.410506+00	\N
2	v3xRwEF3SLnu7NmLTFLrv6Yq7bToRBhO	Rumah	Jl Ramah tamah	-2.718193764041544	111.64142607577789	Gerbang Hijau	t	\N	2026-06-12 03:30:24.061644+00	\N
3	gyGNgmGQm16NKS56RYtNySQYUW7m9p6N	Rumah	Rarait 3 GG natai Wijaya 3	-2.6681098	111.6539483	Barakan kuning sebelah kanan pintu no 1	t	\N	2026-06-16 09:12:31.51203+00	\N
\.


ALTER TABLE public.locations ENABLE TRIGGER ALL;

--
-- Data for Name: promos; Type: TABLE DATA; Schema: public; Owner: rizkgin
--

ALTER TABLE public.promos DISABLE TRIGGER ALL;

COPY public.promos (id, code, title, description, discount_percent, min_order, max_discount, valid_until, gradient, features, is_active, image, updated_at, created_at, deleted_at) FROM stdin;
\.


ALTER TABLE public.promos ENABLE TRIGGER ALL;

--
-- Data for Name: orders; Type: TABLE DATA; Schema: public; Owner: rizkgin
--

ALTER TABLE public.orders DISABLE TRIGGER ALL;

COPY public.orders (id, customer_id, courier_id, outlet_id, status, promo_id, discount_amount, delivery_fee, scheduled_at, note, rejected_by, rejected_reason, updated_at, created_at, deleted_at) FROM stdin;
6c3b467f-7529-4f83-9dc0-103b6f9b8a9f	1	1	1	delivered	\N	\N	10000	\N	{"location":{"pick_up":{"lat":"-2.6802856778421478","long":"111.6320825760843","label":"owner_test's Resto"},"drop_off":{"lat":"-2.718193764041544","long":"111.64142607577789","label":"Jl Ramah tamah"}},"customer_ratings":"5.00","customer_review_count":"0","customer_note":""}	\N	\N	2026-06-12 04:31:16.891+00	2026-06-12 04:30:23.90579+00	\N
abef75d5-f2e6-4b04-952e-f215f4d07d99	2	1	1	delivered	\N	\N	20000	\N	{"location":{"pick_up":{"lat":"-2.6802856778421478","long":"111.6320825760843","label":"owner_test's Resto"},"drop_off":{"lat":"-2.7294889557155577","long":"111.6374333779042","label":"Jl. Antar sari"}},"customer_ratings":"5.00","customer_review_count":"0","customer_note":""}	\N	\N	2026-06-09 04:04:20.421+00	2026-06-09 03:47:03.040953+00	\N
20b958f3-befe-46b1-a10d-cf87dd46bc85	1	1	1	delivered	\N	\N	\N	\N	{"customerName":null,"discountAmount":0,"paymentMethod":"cash","amountPaid":40000,"changeDue":1000}	\N	\N	\N	2026-06-09 04:16:05.991074+00	\N
70a2ab7a-0ee1-4ef3-b4f3-c1c538bb647f	1	1	1	on_delivery	\N	\N	10000	\N	{"location":{"pick_up":{"lat":"-2.6802856778421478","long":"111.6320825760843","label":"owner_test's Resto"},"drop_off":{"lat":"-2.718193764041544","long":"111.64142607577789","label":"Jl Ramah tamah"}},"customer_ratings":"5.00","customer_review_count":"1","customer_note":""}	\N	\N	2026-06-14 03:16:51.445+00	2026-06-12 04:37:17.592191+00	\N
83c2b181-68b4-44a0-b1cf-65b624cf15e6	2	1	1	delivered	\N	\N	20000	\N	{"location":{"pick_up":{"lat":"-2.6802856778421478","long":"111.6320825760843","label":"owner_test's Resto"},"drop_off":{"lat":"-2.7294889557155577","long":"111.6374333779042","label":"Jl. Antar sari"}},"customer_ratings":"5.00","customer_review_count":"1","customer_note":""}	\N	\N	2026-06-09 04:33:26.362+00	2026-06-09 04:32:24.606485+00	\N
66f1eeb0-c99d-4a52-aaf3-215d47bb9248	1	1	1	delivered	\N	\N	\N	\N	{"customerName":null,"discountAmount":0,"paymentMethod":"cash","amountPaid":50000,"changeDue":27000}	\N	\N	\N	2026-06-16 04:07:58.740319+00	\N
8fe62a93-b37b-4c6c-b7f7-a78e39621fee	1	1	4	delivered	\N	\N	\N	\N	{"customerName":null,"discountAmount":0,"paymentMethod":"non_cash","amountPaid":40000,"changeDue":0}	\N	\N	\N	2026-06-16 08:31:45.044845+00	\N
44fbe399-841b-4dd5-8623-1110d7e3c170	3	\N	1	cancelled	\N	\N	10000	\N	{"location":{"pick_up":{"lat":"-2.6802856778421478","long":"111.6320825760843","label":"owner_test's Resto"},"drop_off":{"lat":"-2.6681098","long":"111.6539483","label":"Rarait 3 GG natai Wijaya 3"}},"customer_ratings":"5.00","customer_review_count":"0","customer_note":""}	customer	\N	2026-06-16 09:15:09.322+00	2026-06-16 09:13:40.201626+00	\N
9739e8d5-e692-48ca-8cd9-fb80bd3c1251	1	1	3	delivered	\N	\N	\N	\N	{"customerName":null,"discountAmount":0,"paymentMethod":"non_cash","amountPaid":60000,"changeDue":0}	\N	\N	\N	2026-06-17 01:39:10.682211+00	\N
8c5e2955-3323-4438-a955-a7ffc267c42f	1	1	3	delivered	\N	\N	\N	\N	{"customerName":null,"discountAmount":0,"paymentMethod":"cash","amountPaid":110000,"changeDue":0}	\N	\N	\N	2026-06-17 01:55:15.057711+00	\N
f49782e6-90ff-4660-b345-8c840b121206	1	1	1	delivered	\N	\N	\N	\N	{"customerName":null,"discountAmount":0,"paymentMethod":"cash","amountPaid":100000,"changeDue":27500}	\N	\N	\N	2026-06-18 04:45:03.058347+00	\N
\.


ALTER TABLE public.orders ENABLE TRIGGER ALL;

--
-- Data for Name: products; Type: TABLE DATA; Schema: public; Owner: rizkgin
--

ALTER TABLE public.products DISABLE TRIGGER ALL;

COPY public.products (id, product_name, price, price_mark_down, buying_price, outlet_id, ratings, image, category, is_available, description, unit, features, is_recommended, discount_percent, review_count, updated_at, created_at, deleted_at) FROM stdin;
041b1665-ca87-48b1-8d2c-5478840e7ad0	Dry fruit lemon	45000		12000	4	5.00	/products/product-1781598593079-751024791.webp	mart	t	Buah kering lemon 50 gr	pcs	{mart}	t	\N	0	\N	2026-06-16 08:29:58.177466+00	\N
80046377-97ad-4560-880d-19965a003a91	Rice bowl nasduk ayam suwir 	10000		7500	3	5.00	/products/product-1781584259332-819937624.webp	makanan	t	Sarapan siap santap ekonomis dan bergizi 	pcs	{food}	t	\N	0	\N	2026-06-16 04:31:04.454523+00	\N
cf3f1004-6dab-440f-a4d4-bdca6ee7bdb9	Nasi bakar	10000		7000	3	5.00	avatar.png	makanan	t	Nasi yg gurih ditambah dgn isian yg nendang 	pcs	{}	t	\N	0	\N	2026-06-17 01:53:19.797498+00	\N
7012b62a-905c-48b4-89e6-a1192f544e62	Flat White	15000		0	1	5.00	/products/product-1780966778114-725437823.webp	minuman	t	A classic coffee drink made with espresso and steamed milk.	pcs	{drink}	f	\N	0	\N	2026-06-08 12:53:14.283337+00	\N
51478aa2-348d-45ee-96ce-8751b10806ad	Espresso	15000	11500	0	1	5.00	/products/product-1780966732602-924497801.webp	minuman	t	A classic coffee drink made with espresso and steamed milk.	pcs	{drink}	f	\N	1	\N	2026-06-08 12:53:14.281329+00	\N
5152db6a-60e1-4360-ae5d-b62fac1ed90e	Americano	15000		0	1	4.00	/products/product-1780966806954-587844013.webp	minuman	t	A classic coffee drink made with espresso and steamed milk.	pcs	{drink}	f	\N	1	\N	2026-06-08 12:53:14.282325+00	\N
ff32ed7c-1e6f-476f-b79b-f919ef21f237	Cappuccino	22000	18000	15000	1	5.00	/products/product-1780966653947-512128526.webp	minuman	t	A classic coffee drink made with espresso and steamed milk.	pcs	{drink}	f	\N	1	\N	2026-06-08 12:53:14.27823+00	\N
71eb7200-b767-4561-abe2-596b9aefc06c	Mix Platter	20000		0	1	5.00	/products/product-1780966753536-822384948.webp	makanan	t	combined snack of all in 1 plate	pcs	{}	t	\N	0	\N	2026-06-08 12:53:14.284357+00	\N
613d8301-ca5a-4c46-ba76-be941787bca1	Almond Cofee Latte	20000	19500	0	1	5.00	/products/product-1780966705671-792637169.webp	minuman	t	A classic coffee drink made with espresso and steamed milk.	pcs	{drink}	t	\N	2	\N	2026-06-08 12:53:14.280288+00	\N
\.


ALTER TABLE public.products ENABLE TRIGGER ALL;

--
-- Data for Name: orderDetails; Type: TABLE DATA; Schema: public; Owner: rizkgin
--

ALTER TABLE public."orderDetails" DISABLE TRIGGER ALL;

COPY public."orderDetails" (id, order_id, product_id, quantity, note_product, extra, summary_price, created_at, status) FROM stdin;
1	abef75d5-f2e6-4b04-952e-f215f4d07d99	51478aa2-348d-45ee-96ce-8751b10806ad	2	\N	\N	30000	2026-06-09 03:47:03.040953+00	\N
2	abef75d5-f2e6-4b04-952e-f215f4d07d99	5152db6a-60e1-4360-ae5d-b62fac1ed90e	1	\N	\N	15000	2026-06-09 03:47:03.040953+00	\N
3	20b958f3-befe-46b1-a10d-cf87dd46bc85	613d8301-ca5a-4c46-ba76-be941787bca1	2	-	\N	39000	2026-06-09 04:16:05.991074+00	checkout
4	83c2b181-68b4-44a0-b1cf-65b624cf15e6	ff32ed7c-1e6f-476f-b79b-f919ef21f237	1	\N	\N	22000	2026-06-09 04:32:24.606485+00	checkout
5	83c2b181-68b4-44a0-b1cf-65b624cf15e6	613d8301-ca5a-4c46-ba76-be941787bca1	1	\N	\N	20000	2026-06-09 04:32:24.606485+00	checkout
7	6c3b467f-7529-4f83-9dc0-103b6f9b8a9f	613d8301-ca5a-4c46-ba76-be941787bca1	2	\N	\N	40000	2026-06-12 04:30:23.90579+00	checkout
8	70a2ab7a-0ee1-4ef3-b4f3-c1c538bb647f	5152db6a-60e1-4360-ae5d-b62fac1ed90e	1	\N	\N	15000	2026-06-12 04:37:17.592191+00	\N
9	66f1eeb0-c99d-4a52-aaf3-215d47bb9248	51478aa2-348d-45ee-96ce-8751b10806ad	2	-	\N	23000	2026-06-16 04:07:58.740319+00	checkout
10	8fe62a93-b37b-4c6c-b7f7-a78e39621fee	041b1665-ca87-48b1-8d2c-5478840e7ad0	1	-	\N	40000	2026-06-16 08:31:45.044845+00	checkout
11	44fbe399-841b-4dd5-8623-1110d7e3c170	71eb7200-b767-4561-abe2-596b9aefc06c	1	\N	\N	20000	2026-06-16 09:13:40.201626+00	\N
12	44fbe399-841b-4dd5-8623-1110d7e3c170	613d8301-ca5a-4c46-ba76-be941787bca1	1	\N	\N	20000	2026-06-16 09:13:40.201626+00	\N
13	9739e8d5-e692-48ca-8cd9-fb80bd3c1251	80046377-97ad-4560-880d-19965a003a91	6	-	\N	60000	2026-06-17 01:39:10.682211+00	checkout
14	8c5e2955-3323-4438-a955-a7ffc267c42f	cf3f1004-6dab-440f-a4d4-bdca6ee7bdb9	11	-	\N	110000	2026-06-17 01:55:15.057711+00	checkout
15	f49782e6-90ff-4660-b345-8c840b121206	71eb7200-b767-4561-abe2-596b9aefc06c	1	-	\N	20000	2026-06-18 04:45:03.058347+00	checkout
16	f49782e6-90ff-4660-b345-8c840b121206	613d8301-ca5a-4c46-ba76-be941787bca1	1	-	\N	19500	2026-06-18 04:45:03.058347+00	checkout
17	f49782e6-90ff-4660-b345-8c840b121206	5152db6a-60e1-4360-ae5d-b62fac1ed90e	1	-	\N	15000	2026-06-18 04:45:03.058347+00	checkout
18	f49782e6-90ff-4660-b345-8c840b121206	ff32ed7c-1e6f-476f-b79b-f919ef21f237	1	-	\N	18000	2026-06-18 04:45:03.058347+00	checkout
\.


ALTER TABLE public."orderDetails" ENABLE TRIGGER ALL;

--
-- Data for Name: product_ads; Type: TABLE DATA; Schema: public; Owner: rizkgin
--

ALTER TABLE public.product_ads DISABLE TRIGGER ALL;

COPY public.product_ads (id, outlet_id, product_id, title, description, banner_image, status, is_active, rejection_reason, updated_at, created_at, deleted_at, starts_at, ends_at) FROM stdin;
5	1	7012b62a-905c-48b4-89e6-a1192f544e62	Promo Reformasi	Untuk mendukung kamu ♥️	/ads/ad-1781402495115-317584723.webp	approved	t	\N	\N	2026-06-14 02:01:42.906929+00	\N	2026-06-14 02:01:42.905+00	2026-06-21 02:01:42.905+00
6	1	51478aa2-348d-45ee-96ce-8751b10806ad	Spesial America dollar menguat	Espresso Murah meski dollar menguat	/ads/ad-1781404908096-781256330.webp	approved	t	\N	\N	2026-06-14 02:41:50.284805+00	\N	2026-06-14 02:41:50.303+00	2026-06-28 02:41:50.303+00
7	1	71eb7200-b767-4561-abe2-596b9aefc06c	Mix not mixing 	Buat temenin main	/ads/ad-1781405501353-572532364.webp	approved	t	\N	\N	2026-06-14 02:51:43.464945+00	\N	2026-06-14 02:51:43.464+00	2026-06-28 02:51:43.464+00
4	1	7012b62a-905c-48b4-89e6-a1192f544e62	...	....	/ads/ad-1781233839554-793519462.webp	approved	f	\N	\N	2026-06-12 03:10:42.3863+00	\N	2026-06-12 03:10:42.385+00	2026-06-19 03:10:42.385+00
\.


ALTER TABLE public.product_ads ENABLE TRIGGER ALL;

--
-- Data for Name: schedule_product_ads; Type: TABLE DATA; Schema: public; Owner: rizkgin
--

ALTER TABLE public.schedule_product_ads DISABLE TRIGGER ALL;

COPY public.schedule_product_ads (id, time_display) FROM stdin;
1	{"day":"sunday","hour":"01"}
2	{"day":"sunday","hour":"02"}
3	{"day":"sunday","hour":"03"}
4	{"day":"sunday","hour":"04"}
5	{"day":"sunday","hour":"05"}
6	{"day":"sunday","hour":"06"}
7	{"day":"sunday","hour":"07"}
8	{"day":"sunday","hour":"08"}
9	{"day":"sunday","hour":"09"}
10	{"day":"sunday","hour":"10"}
11	{"day":"sunday","hour":"11"}
12	{"day":"sunday","hour":"12"}
13	{"day":"sunday","hour":"13"}
14	{"day":"sunday","hour":"14"}
15	{"day":"sunday","hour":"15"}
16	{"day":"sunday","hour":"16"}
17	{"day":"sunday","hour":"17"}
18	{"day":"sunday","hour":"18"}
19	{"day":"sunday","hour":"19"}
20	{"day":"sunday","hour":"20"}
21	{"day":"sunday","hour":"21"}
22	{"day":"sunday","hour":"22"}
23	{"day":"sunday","hour":"23"}
24	{"day":"sunday","hour":"24"}
25	{"day":"monday","hour":"01"}
26	{"day":"monday","hour":"02"}
27	{"day":"monday","hour":"03"}
28	{"day":"monday","hour":"04"}
29	{"day":"monday","hour":"05"}
30	{"day":"monday","hour":"06"}
31	{"day":"monday","hour":"07"}
32	{"day":"monday","hour":"08"}
33	{"day":"monday","hour":"09"}
34	{"day":"monday","hour":"10"}
35	{"day":"monday","hour":"11"}
36	{"day":"monday","hour":"12"}
37	{"day":"monday","hour":"13"}
38	{"day":"monday","hour":"14"}
39	{"day":"monday","hour":"15"}
40	{"day":"monday","hour":"16"}
41	{"day":"monday","hour":"17"}
42	{"day":"monday","hour":"18"}
43	{"day":"monday","hour":"19"}
44	{"day":"monday","hour":"20"}
45	{"day":"monday","hour":"21"}
46	{"day":"monday","hour":"22"}
47	{"day":"monday","hour":"23"}
48	{"day":"monday","hour":"24"}
49	{"day":"tuesday","hour":"01"}
50	{"day":"tuesday","hour":"02"}
51	{"day":"tuesday","hour":"03"}
52	{"day":"tuesday","hour":"04"}
53	{"day":"tuesday","hour":"05"}
54	{"day":"tuesday","hour":"06"}
55	{"day":"tuesday","hour":"07"}
56	{"day":"tuesday","hour":"08"}
57	{"day":"tuesday","hour":"09"}
58	{"day":"tuesday","hour":"10"}
59	{"day":"tuesday","hour":"11"}
60	{"day":"tuesday","hour":"12"}
61	{"day":"tuesday","hour":"13"}
62	{"day":"tuesday","hour":"14"}
63	{"day":"tuesday","hour":"15"}
64	{"day":"tuesday","hour":"16"}
65	{"day":"tuesday","hour":"17"}
66	{"day":"tuesday","hour":"18"}
67	{"day":"tuesday","hour":"19"}
68	{"day":"tuesday","hour":"20"}
69	{"day":"tuesday","hour":"21"}
70	{"day":"tuesday","hour":"22"}
71	{"day":"tuesday","hour":"23"}
72	{"day":"tuesday","hour":"24"}
73	{"day":"wednesday","hour":"01"}
74	{"day":"wednesday","hour":"02"}
75	{"day":"wednesday","hour":"03"}
76	{"day":"wednesday","hour":"04"}
77	{"day":"wednesday","hour":"05"}
78	{"day":"wednesday","hour":"06"}
79	{"day":"wednesday","hour":"07"}
80	{"day":"wednesday","hour":"08"}
81	{"day":"wednesday","hour":"09"}
82	{"day":"wednesday","hour":"10"}
83	{"day":"wednesday","hour":"11"}
84	{"day":"wednesday","hour":"12"}
85	{"day":"wednesday","hour":"13"}
86	{"day":"wednesday","hour":"14"}
87	{"day":"wednesday","hour":"15"}
88	{"day":"wednesday","hour":"16"}
89	{"day":"wednesday","hour":"17"}
90	{"day":"wednesday","hour":"18"}
91	{"day":"wednesday","hour":"19"}
92	{"day":"wednesday","hour":"20"}
93	{"day":"wednesday","hour":"21"}
94	{"day":"wednesday","hour":"22"}
95	{"day":"wednesday","hour":"23"}
96	{"day":"wednesday","hour":"24"}
97	{"day":"thursday","hour":"01"}
98	{"day":"thursday","hour":"02"}
99	{"day":"thursday","hour":"03"}
100	{"day":"thursday","hour":"04"}
101	{"day":"thursday","hour":"05"}
102	{"day":"thursday","hour":"06"}
103	{"day":"thursday","hour":"07"}
104	{"day":"thursday","hour":"08"}
105	{"day":"thursday","hour":"09"}
106	{"day":"thursday","hour":"10"}
107	{"day":"thursday","hour":"11"}
108	{"day":"thursday","hour":"12"}
109	{"day":"thursday","hour":"13"}
110	{"day":"thursday","hour":"14"}
111	{"day":"thursday","hour":"15"}
112	{"day":"thursday","hour":"16"}
113	{"day":"thursday","hour":"17"}
114	{"day":"thursday","hour":"18"}
115	{"day":"thursday","hour":"19"}
116	{"day":"thursday","hour":"20"}
117	{"day":"thursday","hour":"21"}
118	{"day":"thursday","hour":"22"}
119	{"day":"thursday","hour":"23"}
120	{"day":"thursday","hour":"24"}
121	{"day":"friday","hour":"01"}
122	{"day":"friday","hour":"02"}
123	{"day":"friday","hour":"03"}
124	{"day":"friday","hour":"04"}
125	{"day":"friday","hour":"05"}
126	{"day":"friday","hour":"06"}
127	{"day":"friday","hour":"07"}
128	{"day":"friday","hour":"08"}
129	{"day":"friday","hour":"09"}
130	{"day":"friday","hour":"10"}
131	{"day":"friday","hour":"11"}
132	{"day":"friday","hour":"12"}
133	{"day":"friday","hour":"13"}
134	{"day":"friday","hour":"14"}
135	{"day":"friday","hour":"15"}
136	{"day":"friday","hour":"16"}
137	{"day":"friday","hour":"17"}
138	{"day":"friday","hour":"18"}
139	{"day":"friday","hour":"19"}
140	{"day":"friday","hour":"20"}
141	{"day":"friday","hour":"21"}
142	{"day":"friday","hour":"22"}
143	{"day":"friday","hour":"23"}
144	{"day":"friday","hour":"24"}
145	{"day":"saturday","hour":"01"}
146	{"day":"saturday","hour":"02"}
147	{"day":"saturday","hour":"03"}
148	{"day":"saturday","hour":"04"}
149	{"day":"saturday","hour":"05"}
150	{"day":"saturday","hour":"06"}
151	{"day":"saturday","hour":"07"}
152	{"day":"saturday","hour":"08"}
153	{"day":"saturday","hour":"09"}
154	{"day":"saturday","hour":"10"}
155	{"day":"saturday","hour":"11"}
156	{"day":"saturday","hour":"12"}
157	{"day":"saturday","hour":"13"}
158	{"day":"saturday","hour":"14"}
159	{"day":"saturday","hour":"15"}
160	{"day":"saturday","hour":"16"}
161	{"day":"saturday","hour":"17"}
162	{"day":"saturday","hour":"18"}
163	{"day":"saturday","hour":"19"}
164	{"day":"saturday","hour":"20"}
165	{"day":"saturday","hour":"21"}
166	{"day":"saturday","hour":"22"}
167	{"day":"saturday","hour":"23"}
168	{"day":"saturday","hour":"24"}
\.


ALTER TABLE public.schedule_product_ads ENABLE TRIGGER ALL;

--
-- Data for Name: product_ads_schedule; Type: TABLE DATA; Schema: public; Owner: rizkgin
--

ALTER TABLE public.product_ads_schedule DISABLE TRIGGER ALL;

COPY public.product_ads_schedule (id, schedule_products_ads_id, products_ads_id) FROM stdin;
14	32	4
15	33	4
16	34	4
17	35	4
18	36	4
19	37	4
20	38	4
21	39	4
22	40	4
23	41	4
24	9	5
25	10	5
26	11	5
27	32	6
28	33	6
29	34	6
30	56	6
31	57	6
32	58	6
33	80	6
34	81	6
35	82	6
36	104	6
37	105	6
38	106	6
39	128	6
40	129	6
41	130	6
42	8	7
43	9	7
44	10	7
45	11	7
46	12	7
47	13	7
48	14	7
49	15	7
50	16	7
51	17	7
52	152	7
53	153	7
54	154	7
55	155	7
56	156	7
57	157	7
58	158	7
59	159	7
60	160	7
61	161	7
\.


ALTER TABLE public.product_ads_schedule ENABLE TRIGGER ALL;

--
-- Data for Name: ratings; Type: TABLE DATA; Schema: public; Owner: rizkgin
--

ALTER TABLE public.ratings DISABLE TRIGGER ALL;

COPY public.ratings (id, order_details_id, ratings, comment, reviewer_id, reciepent_id, outlet_id, product_id, reciepent_as, updated_at, created_at, deleted_at) FROM stdin;
bdde8d9b-7912-4edd-99d1-e865bd33a816	1	5.00	Mas rizky ramah, dan ga ribet	uoiuR0aAFVqw247968HuPM8TBTI1frEv	ZWMPMbrCOcIIPjswKOmPy7F5ZgXDyOK4	\N	\N	customer	\N	2026-06-09 04:09:43.987386+00	\N
6db4123e-b73c-4c3f-a2b5-5824c6c8e705	1	5.00	Enak kursinya buat nunggu kurir	uoiuR0aAFVqw247968HuPM8TBTI1frEv	\N	1	\N	outlet	\N	2026-06-09 04:09:43.987386+00	\N
6e3ea889-0156-453b-b0fc-f5646f1625ed	1	5.00	KURIRNYA BAGUS	ZWMPMbrCOcIIPjswKOmPy7F5ZgXDyOK4	uoiuR0aAFVqw247968HuPM8TBTI1frEv	\N	\N	courier	\N	2026-06-09 04:10:15.576349+00	\N
0fc70381-9b66-4b5d-8f07-f030479e6b4c	1	5.00	enak, manisnya pas	ZWMPMbrCOcIIPjswKOmPy7F5ZgXDyOK4	\N	\N	51478aa2-348d-45ee-96ce-8751b10806ad	product	\N	2026-06-09 04:10:15.576349+00	\N
597c8859-9562-481a-952e-21640faa33bb	2	4.00	Agak kebanyakan air rasanya	ZWMPMbrCOcIIPjswKOmPy7F5ZgXDyOK4	\N	\N	5152db6a-60e1-4360-ae5d-b62fac1ed90e	product	\N	2026-06-09 04:10:15.576349+00	\N
5bd6ad56-2440-4525-aca4-d13b565de0e4	4	5.00	Sudah 2 kali nganterin dan gercep rumahnya juga gampang dicari	uoiuR0aAFVqw247968HuPM8TBTI1frEv	ZWMPMbrCOcIIPjswKOmPy7F5ZgXDyOK4	\N	\N	customer	\N	2026-06-09 04:33:56.78651+00	\N
6a84ad2e-21b5-46a9-8b9a-47f8d9645f08	4	5.00	Seperti biasa, ini outlet bagus	uoiuR0aAFVqw247968HuPM8TBTI1frEv	\N	1	\N	outlet	\N	2026-06-09 04:33:56.78651+00	\N
460432a6-f077-4800-be08-4d0bee1476e6	4	5.00	Semangat pak.	ZWMPMbrCOcIIPjswKOmPy7F5ZgXDyOK4	uoiuR0aAFVqw247968HuPM8TBTI1frEv	\N	\N	courier	\N	2026-06-09 04:34:14.521009+00	\N
7623a192-3e99-48a4-a2ac-86d9b623a960	4	5.00	\N	ZWMPMbrCOcIIPjswKOmPy7F5ZgXDyOK4	\N	\N	ff32ed7c-1e6f-476f-b79b-f919ef21f237	product	\N	2026-06-09 04:34:14.521009+00	\N
2c5959d5-a7b3-4b10-83b4-06aa53888321	5	5.00	\N	ZWMPMbrCOcIIPjswKOmPy7F5ZgXDyOK4	\N	\N	613d8301-ca5a-4c46-ba76-be941787bca1	product	\N	2026-06-09 04:34:14.521009+00	\N
17645833-4fab-48cb-b633-9d930ec970d9	7	5.00	\N	uoiuR0aAFVqw247968HuPM8TBTI1frEv	v3xRwEF3SLnu7NmLTFLrv6Yq7bToRBhO	\N	\N	customer	\N	2026-06-12 04:31:28.834272+00	\N
8ee52bb1-25e3-4c03-9d0f-fd3a2ec35c59	7	5.00	\N	uoiuR0aAFVqw247968HuPM8TBTI1frEv	\N	1	\N	outlet	\N	2026-06-12 04:31:28.834272+00	\N
ec0bc184-16e6-4c3f-935d-b64c31e150cc	7	5.00	\N	v3xRwEF3SLnu7NmLTFLrv6Yq7bToRBhO	uoiuR0aAFVqw247968HuPM8TBTI1frEv	\N	\N	courier	\N	2026-06-12 04:31:32.922368+00	\N
c451d6a4-3f34-4d50-a2b9-a80f7db7b055	7	5.00	\N	v3xRwEF3SLnu7NmLTFLrv6Yq7bToRBhO	\N	\N	613d8301-ca5a-4c46-ba76-be941787bca1	product	\N	2026-06-12 04:31:32.922368+00	\N
\.


ALTER TABLE public.ratings ENABLE TRIGGER ALL;

--
-- Data for Name: session; Type: TABLE DATA; Schema: public; Owner: rizkgin
--

ALTER TABLE public.session DISABLE TRIGGER ALL;

COPY public.session (id, expires_at, token, created_at, updated_at, ip_address, user_agent, user_id) FROM stdin;
L1C8urOWZ2ZoZqh0ybcSz3wEfLsKtOum	2026-06-15 12:53:14.194+00	bSd4pUxtPjHDGP6Q08aqXo5sepx7h7H0	2026-06-08 12:53:14.194+00	2026-06-08 12:53:14.194+00			v3xRwEF3SLnu7NmLTFLrv6Yq7bToRBhO
sGp2pRcZcv3cJoTafUlLuuMyzsifVhLD	2026-06-15 12:53:14.27+00	90q5fzHUmOXUnHKxFuT3QPd5i79TvBsB	2026-06-08 12:53:14.27+00	2026-06-08 12:53:14.27+00			fsD8l2mMnLbEQ35CvZLkQYrR8pJz6WE0
GFGBZ7kwgolwnMb78rNoBBXGFgNYTm07	2026-06-15 12:53:14.353+00	bx5XhTFV32NvPemV0MYFwisumFrsT41Q	2026-06-08 12:53:14.353+00	2026-06-08 12:53:14.353+00			uoiuR0aAFVqw247968HuPM8TBTI1frEv
2wyxOZeFncjrmfAcadv1ywPhQIzDZOyN	2026-06-15 12:53:14.426+00	CNcFvG6SJLgARCUUQhT94JnEDpUZBVi7	2026-06-08 12:53:14.426+00	2026-06-08 12:53:14.426+00			ZWMPMbrCOcIIPjswKOmPy7F5ZgXDyOK4
yB6HeLkNrmfWSPOCdr1Gf15ZdRgw9ypl	2026-06-16 00:56:59.259+00	0htnPmNh43OYfR9sQvN3MXrSGFZlvXvW	2026-06-09 00:56:59.259+00	2026-06-09 00:56:59.259+00	0000:0000:0000:0000:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36	fsD8l2mMnLbEQ35CvZLkQYrR8pJz6WE0
jfhksOmewrsTfVGD7jNg3md3sniDIjSX	2026-06-16 03:42:50.035+00	rUVbuFaMFMIkUCQBaSLwJSwdHgpD09wd	2026-06-09 03:42:50.035+00	2026-06-09 03:42:50.035+00	0000:0000:0000:0000:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36	ZWMPMbrCOcIIPjswKOmPy7F5ZgXDyOK4
ZjXEaB1Sl5zIZ1JIBvMFuNkYaHbJrh3T	2026-06-16 04:31:26.834+00	U6GB8zk8pALkLlopeiwAyt4CpJV7kcA3	2026-06-09 04:31:26.835+00	2026-06-09 04:31:26.835+00	0000:0000:0000:0000:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36	ZWMPMbrCOcIIPjswKOmPy7F5ZgXDyOK4
Zdasnwn1ycv7p8aFr6auIphmi3UTZIpp	2026-06-17 08:12:39.513+00	kyFLMkG53PDDbeBCQkF5J3K16NT9KoC0	2026-06-10 08:12:39.514+00	2026-06-10 08:12:39.514+00	0000:0000:0000:0000:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36	8vw0ltUCxfFLtMse1NeIYzGaMiBBRdoB
Db37i7EbsNowHdgH1obicqHM1DYvb3PX	2026-06-17 08:12:43.003+00	of1kEWgaMKQjedzBDcPKzmWW7r9JfagK	2026-06-10 08:12:43.003+00	2026-06-10 08:12:43.003+00	0000:0000:0000:0000:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36	8vw0ltUCxfFLtMse1NeIYzGaMiBBRdoB
wfcSR33zUz77yG9kuDxNbOBkN8DYGnNe	2026-06-18 02:15:30.431+00	nzLLpzffWa0GJ7F3LIILsYAJmQm1fvLr	2026-06-11 02:15:30.432+00	2026-06-11 02:15:30.432+00	0000:0000:0000:0000:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36	ZWMPMbrCOcIIPjswKOmPy7F5ZgXDyOK4
mLmAk8T2LMBMGZp4FSi4gJxD9le3XgcK	2026-06-18 02:30:57.906+00	OH5UHWVwedBgihGiAl3oVYzdL9ccNVgt	2026-06-11 02:30:57.906+00	2026-06-11 02:30:57.906+00	0000:0000:0000:0000:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36	fsD8l2mMnLbEQ35CvZLkQYrR8pJz6WE0
rJYwkqUMnMK9cM71uXdAR2siYY2CcXkK	2026-06-18 02:42:57.55+00	r41BrsaALf31Jp0nB73LFbz4An8C1mOg	2026-06-11 02:42:57.55+00	2026-06-11 02:42:57.55+00	0000:0000:0000:0000:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36	ZWMPMbrCOcIIPjswKOmPy7F5ZgXDyOK4
Beubzb6bjAiQoYQcZXQcok4yHq6ZDh9R	2026-06-18 05:36:52.103+00	8KZ94qn0EFO4pvPbMr7TN9WxfQlj7fQJ	2026-06-11 05:36:52.105+00	2026-06-11 05:36:52.105+00	0000:0000:0000:0000:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36	fsD8l2mMnLbEQ35CvZLkQYrR8pJz6WE0
dAV3arndbdyJNaMbWCsPgrwcxyHad63S	2026-06-19 01:33:29.177+00	aEIIINRsINdVEu1ZxrscUphVtvTMsUVP	2026-06-12 01:33:29.178+00	2026-06-12 01:33:29.178+00	0000:0000:0000:0000:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36	8vw0ltUCxfFLtMse1NeIYzGaMiBBRdoB
xBCIsGIPtOIMbFXWRt3odFpoi8wdmAg6	2026-06-19 02:28:10.733+00	lWcWSaUYeVG3IrYOepAC1FnGq2qo0do5	2026-06-12 02:28:10.734+00	2026-06-12 02:28:10.734+00	0000:0000:0000:0000:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36	fsD8l2mMnLbEQ35CvZLkQYrR8pJz6WE0
XvSfHceW7S68tgtmDuqynxO8gSC9smS5	2026-06-19 02:34:36.837+00	HYt7nExtk4CoVoBxGvpOKQlqpkA2TfRj	2026-06-12 02:34:36.838+00	2026-06-12 02:34:36.838+00	0000:0000:0000:0000:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36	8vw0ltUCxfFLtMse1NeIYzGaMiBBRdoB
v2TlR4Ba5U781NhLLk00LPfn11T5oCsJ	2026-06-19 04:25:31.018+00	48lybvhbGN9N0Onht1SlYytaPe8eXpNQ	2026-06-12 04:25:31.018+00	2026-06-12 04:25:31.018+00	0000:0000:0000:0000:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36	v3xRwEF3SLnu7NmLTFLrv6Yq7bToRBhO
puzynwVFgI8dWj6ShMxZJopFlU4rARjj	2026-06-19 03:41:00.656+00	Xl5odTqdoSLO1msDBqADszzKsXlTQ5le	2026-06-12 03:41:00.656+00	2026-06-12 03:41:00.656+00	0000:0000:0000:0000:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36	uoiuR0aAFVqw247968HuPM8TBTI1frEv
yKeEDjY44z0387SVqW3Ermun9zxtm0ij	2026-06-21 01:40:44.664+00	j7Yt9KOGbbvRuyGsNaVa8O0fKnB5I9dx	2026-06-13 00:27:02.229+00	2026-06-14 01:40:44.665+00	2404:00c0:c203:e542:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36	fsD8l2mMnLbEQ35CvZLkQYrR8pJz6WE0
3qri8qrF5k7S1SHfqNJASeh2nKn3P7gr	2026-06-21 01:57:27.095+00	mt4H4yFDzJKlxw3WlGzBnbtmOTA1eGz1	2026-06-14 01:57:27.096+00	2026-06-14 01:57:27.096+00	182.4.39.89	Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36	ZWMPMbrCOcIIPjswKOmPy7F5ZgXDyOK4
95ixrDCyzMPPSXFInZA0evstWCqS6dfQ	2026-06-21 02:02:33.689+00	R3UaziqP51OsYOTWhcUlS9LuzNeEv4CX	2026-06-14 02:02:33.689+00	2026-06-14 02:02:33.689+00	2404:00c0:c204:285b:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36	8vw0ltUCxfFLtMse1NeIYzGaMiBBRdoB
WJyjgPEF2FLWYmyzDILVtTchAbXcd1jJ	2026-06-21 02:42:10.304+00	26M77pN7N9IHGZeaAH2fIzBFkfeDRZSH	2026-06-14 02:42:10.305+00	2026-06-14 02:42:10.305+00	2404:00c0:c204:285b:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36	8vw0ltUCxfFLtMse1NeIYzGaMiBBRdoB
PYTIYeNz68RgZGl1BoZSfmxGeCkH4wqR	2026-06-21 02:43:21.811+00	fRCOTvmkfyR1lifoX74GyPjysnSYuI4U	2026-06-14 02:43:21.811+00	2026-06-14 02:43:21.811+00	2404:00c0:c204:285b:0000:0000:0000:0000	Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36	ZWMPMbrCOcIIPjswKOmPy7F5ZgXDyOK4
kZ11ST81PVKcxW8rEXLACt7T8dbv5t5K	2026-06-21 03:04:14.814+00	KexhLv7Z93YcJK1R11ifqX6YXHtXcR5h	2026-06-14 03:04:14.814+00	2026-06-14 03:04:14.814+00	2404:00c0:c204:285b:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36	80XRU86oAyLaCCxolvqrWgCr9N8cZSbx
4ZN0P2A87Kgyar5PsUXliYrxiUpy4S9o	2026-06-21 03:04:20.974+00	gEzB8L7AcnxIa5OBYBDbLjqqmO3FPJ5a	2026-06-14 03:04:20.974+00	2026-06-14 03:04:20.974+00	2404:00c0:c204:285b:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36	80XRU86oAyLaCCxolvqrWgCr9N8cZSbx
hL2PAtebWITh1YmWmg91L9RV3OajkHLo	2026-06-22 10:09:07.295+00	U1F0Y275743hlkYaWUV3fBmBHyqw5eA2	2026-06-15 10:09:07.295+00	2026-06-15 10:09:07.295+00	2404:00c0:c204:285b:0000:0000:0000:0000	Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36	fsD8l2mMnLbEQ35CvZLkQYrR8pJz6WE0
KiFiqkhRvauPrR1vK2TFFNwS7k4DJoeQ	2026-06-22 10:22:24.154+00	7X4sGFNrHfa3SPXdRpqaGyEADb0sME2q	2026-06-15 10:22:24.155+00	2026-06-15 10:22:24.155+00	2404:00c0:c204:285b:0000:0000:0000:0000	Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36	fsD8l2mMnLbEQ35CvZLkQYrR8pJz6WE0
LMobJVz9eOObnhQoqWFlbSBT4TRQQtMw	2026-06-23 04:05:47.82+00	hngi1iLRLLBX1TVfdrrPbAY11qr72vh8	2026-06-16 04:05:47.822+00	2026-06-16 04:05:47.822+00	182.4.37.159	Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36	fsD8l2mMnLbEQ35CvZLkQYrR8pJz6WE0
rRbYYZSXcpuMiyKkWYA3qgp0ToAtzZrm	2026-06-23 04:17:37.168+00	pOsr4kMGzfw8f6PYA1c93sxdZWIqVsMz	2026-06-16 04:17:37.168+00	2026-06-16 04:17:37.168+00	103.108.30.76	Mozilla/5.0 (Linux; U; Android 15; id-id; CPH2591 Build/AP3A.240617.008) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.5970.168 Mobile Safari/537.36 HeyTapBrowser/45.14.3.1	KuVMtujRiDnRonYzER896L76xok0h2oi
jL3Lj1kmzJzZGCCYgsRXmF54piZ6EjpN	2026-06-23 04:17:41.114+00	0mzhQOJFmC7voiyZcqTMmvC5EaBp0xAZ	2026-06-16 04:17:41.114+00	2026-06-16 04:17:41.114+00	103.108.30.76	Mozilla/5.0 (Linux; U; Android 15; id-id; CPH2591 Build/AP3A.240617.008) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.5970.168 Mobile Safari/537.36 HeyTapBrowser/45.14.3.1	KuVMtujRiDnRonYzER896L76xok0h2oi
R8bQ43KdTg8MDML8EmKsKeY0rgITGiAw	2026-06-23 04:37:26.888+00	LADzjUk4kUBJIEu4qBhIKU7UNrboEymi	2026-06-16 04:37:26.889+00	2026-06-16 04:37:26.889+00	103.108.30.76	Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36	KuVMtujRiDnRonYzER896L76xok0h2oi
9fdTUJYOqewN0oOeErS37rFUrqk5f63G	2026-06-23 04:53:21.622+00	NmtRo6sGURyhgxyODtt0RSsTLfAbc201	2026-06-16 04:53:21.623+00	2026-06-16 04:53:21.623+00	103.108.30.76	Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36	KuVMtujRiDnRonYzER896L76xok0h2oi
qJnMr803oMbRm9gB0hjftkfUyo40iwB7	2026-06-23 06:20:38.582+00	RGnfIzkHK7aOhe3uo4Lh0D9zZpUQFNrI	2026-06-16 06:20:38.582+00	2026-06-16 06:20:38.582+00	2404:00c0:c204:63c5:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36	8vw0ltUCxfFLtMse1NeIYzGaMiBBRdoB
qO7PBtcRugp4t7ijlNbw3zR4Jr4yAvYt	2026-06-23 06:31:55.337+00	0w2zDwLRchsV8h2YFKkOvsEJZmznqj1p	2026-06-16 06:31:55.337+00	2026-06-16 06:31:55.337+00	2404:00c0:c204:63c5:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36	kVDZUKZssWtg1pzt1T9jIxa0jqNc0ECo
7H3c8kApqbD0C5JZQYjDg5EvrmNnj4lN	2026-06-23 06:31:57.422+00	CTyqylRzkYDE6Pj5YJdwvs6x7xqNRdcQ	2026-06-16 06:31:57.422+00	2026-06-16 06:31:57.422+00	2404:00c0:c204:63c5:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36	kVDZUKZssWtg1pzt1T9jIxa0jqNc0ECo
1Szpe1Jw9jEJ5IG60YYXOMY4udF2qtqO	2026-06-23 07:01:49.501+00	K0PmBC36hGMwyhUwBSu5dm7V6wqTb5Jp	2026-06-16 07:01:49.502+00	2026-06-16 07:01:49.502+00	2404:00c0:c204:63c5:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36	B6RgLVE59Jn2tXIQOi4l9FDOz9cQw6LA
0SUGVaiDeTm5WIHZoN0OATAibjnE99WF	2026-06-23 07:08:40.507+00	PsCXIfMhDNUwdm5nL3Pn1wEejZcUm8qi	2026-06-16 07:08:40.507+00	2026-06-16 07:08:40.507+00	2404:00c0:c204:63c5:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36	fsD8l2mMnLbEQ35CvZLkQYrR8pJz6WE0
DnEBj8h7PCNqrzbW64wDfz9y2nSdGKk0	2026-06-23 07:22:34.276+00	oB5igK93BUxfbOkt5rA6GJaOEnmRLYun	2026-06-16 07:22:34.276+00	2026-06-16 07:22:34.276+00	103.108.31.80	Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36	gyGNgmGQm16NKS56RYtNySQYUW7m9p6N
8wtlao3w5Ll9pdAhG4ckZzre4kHgrCNX	2026-06-23 07:22:36.529+00	I6rHh233XhRutge6QI0KyG1Jmtso84yG	2026-06-16 07:22:36.529+00	2026-06-16 07:22:36.529+00	103.108.31.80	Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36	gyGNgmGQm16NKS56RYtNySQYUW7m9p6N
1YjHftOrntD8YZ5hJhr9A5zWaObFJ19B	2026-06-23 08:06:24.298+00	XjOs8ySP7fIUozph1kPN6woQW2RQGbdt	2026-06-16 08:06:24.298+00	2026-06-16 08:06:24.298+00	2404:00c0:c204:63c5:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36	cm2yqqjTzhVwsgTQg5VSWFL0Y3qIExGi
3wStVoHHQDkZPocBgPk8KZ75USNs3uqE	2026-06-23 08:06:28.22+00	ARjluIa6zzi0Ecny6iQhhdsv92h4Zije	2026-06-16 08:06:28.22+00	2026-06-16 08:06:28.22+00	2404:00c0:c204:63c5:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36	cm2yqqjTzhVwsgTQg5VSWFL0Y3qIExGi
TF4JXRftRFNVLFUbHytc0rVYRTgc4mxZ	2026-06-23 08:23:59.197+00	SpzgtZ94xJwy3EjAkyqJalcZkbcYqdlx	2026-06-16 08:23:59.198+00	2026-06-16 08:23:59.198+00	113.11.181.7	Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36	6d1yeaA1qll4OGgcSWT1OH3GUktid50s
cflZwl6MW5DvQOxr3LQQ7flYl7anGRNC	2026-06-23 08:24:13.527+00	I9qkV0pFf4Qyz4mwAIVuPnv1edAaT9mx	2026-06-16 08:24:13.527+00	2026-06-16 08:24:13.527+00	113.11.181.7	Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36	6d1yeaA1qll4OGgcSWT1OH3GUktid50s
R74grBh592nLjrHAZRyE7RofQty8yBrS	2026-06-23 08:51:13.864+00	ALmkeO9Ns2kQwgBzTJfHuurq3rc2gGsU	2026-06-16 08:51:13.864+00	2026-06-16 08:51:13.864+00	182.4.36.10	Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36	v3xRwEF3SLnu7NmLTFLrv6Yq7bToRBhO
tNALhgTyICWxgeM0tHmhKnAKaCeGf57O	2026-06-23 11:09:15.43+00	XgNasS62pPbbBxwJm8aIOZGdgYQW84Jh	2026-06-16 11:09:15.43+00	2026-06-16 11:09:15.43+00	2404:00c0:c204:63c5:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36	8vw0ltUCxfFLtMse1NeIYzGaMiBBRdoB
yq7qlXx2KXZF5lpi41ztesQkbGQn3OxL	2026-06-23 11:14:09.701+00	YbwZ5CS8AqxGlSAk4mZBx0XqtzgFh5CJ	2026-06-16 11:14:09.701+00	2026-06-16 11:14:09.701+00	2404:00c0:c204:63c5:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36	dWghUf3GjdSri0FyozX8QWXsxetnL2y9
atqL532ugjQey8h2KdZk3x4kiCA6U3JQ	2026-06-23 15:46:43.561+00	UlKMoy1pbDOgV1xHCgolWlbviQ7iMPYv	2026-06-16 15:46:43.562+00	2026-06-16 15:46:43.562+00	2404:00c0:c204:63c5:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36	8vw0ltUCxfFLtMse1NeIYzGaMiBBRdoB
ZAszE6L5xjieP1IPUMdWg3iK2kJy6crA	2026-06-23 23:27:42.898+00	aMjBVC0tvxRCWLFLof68sahmSjVijT02	2026-06-16 23:27:42.898+00	2026-06-16 23:27:42.898+00	2404:00c0:c204:63c5:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36	8vw0ltUCxfFLtMse1NeIYzGaMiBBRdoB
nj19H5j1cLPRzilQS56CV00fDONsIO11	2026-06-24 00:46:54.924+00	tvSTnpHaP81exdSE8Joos7mzHUfAXqxz	2026-06-17 00:46:54.924+00	2026-06-17 00:46:54.924+00	103.108.31.69	Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36	KuVMtujRiDnRonYzER896L76xok0h2oi
9EfJaHmyWeecvaKMehXj2sTtWVRFaY8Z	2026-06-24 00:53:17.134+00	nUW7TY8DbsGFpWtwwx0eMluIvAqmTV6l	2026-06-17 00:53:17.134+00	2026-06-17 00:53:17.134+00	39.194.5.4	Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36	fsD8l2mMnLbEQ35CvZLkQYrR8pJz6WE0
8wAWqBAzlgleZCB2ZEJbEUYNz95XJe3y	2026-06-24 01:06:54.34+00	JpTkS4y15VHJivWsJuBQ7FWMO8CKHwcx	2026-06-17 01:06:54.341+00	2026-06-17 01:06:54.341+00	103.108.31.69	Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36	KuVMtujRiDnRonYzER896L76xok0h2oi
NTdfICEnIUGC6eWwpolzqYc59mWyKqSc	2026-06-24 01:13:43.715+00	daSUY0FMyQUapsoCXt8oaqv8ahaZbqq3	2026-06-17 01:13:43.716+00	2026-06-17 01:13:43.716+00	103.108.31.69	Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36	KuVMtujRiDnRonYzER896L76xok0h2oi
ljDIACMrLeWxN5xnD4vZAJsxKESfDlm8	2026-06-24 01:30:49.526+00	KwTv8npssSadYrd8vt1UNCFqAsw0ZUHa	2026-06-17 01:30:49.527+00	2026-06-17 01:30:49.527+00	39.194.5.4	Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36	fsD8l2mMnLbEQ35CvZLkQYrR8pJz6WE0
j3OMHsOgLFovkXA2lF5xy4fZS78xd7O8	2026-06-24 01:36:49.299+00	SYI7Dh0cWyrVt33VrF6qw5HKJ91Ffpjf	2026-06-17 01:36:49.299+00	2026-06-17 01:36:49.299+00	103.108.31.69	Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36	KuVMtujRiDnRonYzER896L76xok0h2oi
Qi9RIAA3Iq6HamaEL2GWljJQdc6gtnoh	2026-06-24 01:44:36.189+00	SvhooD0hH4btMCIjX68SZH753Ge78slq	2026-06-17 01:44:36.19+00	2026-06-17 01:44:36.19+00	103.108.31.69	Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36	KuVMtujRiDnRonYzER896L76xok0h2oi
Mk6lhNgbj1FL6y8dOJLYGU6WsT33yIhp	2026-06-24 08:14:14.417+00	nwFEFJPUV2KJ3VoBDJO5hNsKV35hjF8G	2026-06-17 08:14:14.417+00	2026-06-17 08:14:14.417+00	39.194.5.4	Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36	8vw0ltUCxfFLtMse1NeIYzGaMiBBRdoB
mTbsTNtvEFRBllrPwWK48w2EmOeC8T3I	2026-06-24 10:45:00.89+00	5uht26v8luQbANy4QMu236CzIZG01x77	2026-06-17 10:45:00.891+00	2026-06-17 10:45:00.891+00	103.108.31.73	Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36	KuVMtujRiDnRonYzER896L76xok0h2oi
KXoK91CHSrXykdGJqkDGOq2flTrJaomL	2026-06-24 13:34:46.134+00	HlZV81s3fb07VzcHiSC4Ra7PUxdTuIZ4	2026-06-17 13:34:46.134+00	2026-06-17 13:34:46.134+00	2404:00c0:c204:63c5:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36	6Q5tXyJuE3F9nS1O4gBqv1kMvAdGphUq
NDJUoZvjfSg6QlKTPVWTa8D1PVdVJMv3	2026-06-24 13:37:30.487+00	W1UHSVR5Dq8xkm5WmvWBY1Tf2d0xOJu8	2026-06-17 13:37:30.488+00	2026-06-17 13:37:30.488+00	160.250.22.2	Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/30.0 Chrome/143.0.0.0 Mobile Safari/537.36	x2d1feihutyjKLwow7NiL5BLsZiDfWiz
3DsxIA6L01uCYdW5PjvnGBvCPTOgUtqJ	2026-06-24 13:37:34.832+00	m6Gn9EspXxiQhA0b0pRPNABvOlMDO4FJ	2026-06-17 13:37:34.832+00	2026-06-17 13:37:34.832+00	160.250.22.2	Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/30.0 Chrome/143.0.0.0 Mobile Safari/537.36	x2d1feihutyjKLwow7NiL5BLsZiDfWiz
V1YYadpzw2p5WB9arBSCJjrFm7i2NIMH	2026-06-24 13:39:40.334+00	2hdT8pDhkQJlYrJLY3WWzBJXQHap8XbH	2026-06-17 13:39:40.334+00	2026-06-17 13:39:40.334+00	160.250.22.2	Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/30.0 Chrome/143.0.0.0 Mobile Safari/537.36	JOlWbhFPkzvAHqjDpdYNrCgfGlOtloIx
LPepObPqiAo0LAuMuByyNsPBmW8L2SGW	2026-06-24 13:39:45.668+00	dphyyphh63hDAk8nGlhBTJtzkjRd9QPf	2026-06-17 13:39:45.668+00	2026-06-17 13:39:45.668+00	160.250.22.2	Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/30.0 Chrome/143.0.0.0 Mobile Safari/537.36	JOlWbhFPkzvAHqjDpdYNrCgfGlOtloIx
O4Ldjla7wI7h0eqpz02FoFC5is9rFy8G	2026-06-24 13:47:06.707+00	tX91YMM045PHBgydiFMTllzYmtsXGdm8	2026-06-17 13:47:06.707+00	2026-06-17 13:47:06.707+00	2404:00c0:c204:63c5:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36	fsD8l2mMnLbEQ35CvZLkQYrR8pJz6WE0
D7mVUjCmemSZndjKvhT3zcV9FJnonUs8	2026-06-24 14:26:43.824+00	K5W6Gd5TOzq2PeUrYNYt9VgucPPRJ0TN	2026-06-17 14:26:43.825+00	2026-06-17 14:26:43.825+00	2404:00c0:c204:63c5:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/149.0.7827.55 Safari/537.36	8vw0ltUCxfFLtMse1NeIYzGaMiBBRdoB
6hxUyrFl76zhccDZYTx8ZTeRB9yp7IHW	2026-06-24 14:29:15.634+00	LmJVZsWDsi57LqmGYLgfkkT4GWPIaKwC	2026-06-17 14:29:15.634+00	2026-06-17 14:29:15.634+00	2404:00c0:c204:63c5:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/149.0.7827.55 Safari/537.36	8vw0ltUCxfFLtMse1NeIYzGaMiBBRdoB
e5DIMMjUA38qpp7fOemQ7bx5uBE7RJGL	2026-06-24 14:29:55.52+00	zwPMaoxpQl0IVB0bq4PYGnOm1fqsf1tX	2026-06-17 14:29:55.52+00	2026-06-17 14:29:55.52+00	2404:00c0:c204:63c5:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/149.0.7827.55 Safari/537.36	8vw0ltUCxfFLtMse1NeIYzGaMiBBRdoB
cF6GiUUnYPCq6LAp66556pkhMGvooxXy	2026-06-24 14:30:33.865+00	rdBY8VDRjKcWr0vuJLGG9WLNS5vZRaHM	2026-06-17 14:30:33.865+00	2026-06-17 14:30:33.865+00	2404:00c0:c204:63c5:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/149.0.7827.55 Safari/537.36	8vw0ltUCxfFLtMse1NeIYzGaMiBBRdoB
rU0qCW7SyH7tTqGoh2afjRKwElgCL16n	2026-06-24 14:35:50.317+00	P73ivO5vWP2wFNqersqJyDmZVnIRBnFf	2026-06-17 14:35:50.318+00	2026-06-17 14:35:50.318+00	2404:00c0:c204:63c5:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/149.0.7827.55 Safari/537.36	8vw0ltUCxfFLtMse1NeIYzGaMiBBRdoB
GShwzUtIpozzgvw2qvvNZTWiKBMlchf6	2026-06-24 14:38:34.731+00	eLJuSawbzKQPll2AEVR0ToDUaLwLZ9jS	2026-06-17 14:38:34.731+00	2026-06-17 14:38:34.731+00	2404:00c0:c204:63c5:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/149.0.7827.55 Safari/537.36	8vw0ltUCxfFLtMse1NeIYzGaMiBBRdoB
NvSLeVaZEjLnZyuxogRXx1GQkxQy7G5r	2026-06-24 14:38:59.924+00	AccF0kRPJCUjMgOMkZpAGW3c6yuRuFGf	2026-06-17 14:38:59.924+00	2026-06-17 14:38:59.924+00	2404:00c0:c204:63c5:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/149.0.7827.55 Safari/537.36	8vw0ltUCxfFLtMse1NeIYzGaMiBBRdoB
3nog07MdzbSYkSgAx37ZkwaWQ9UMa53r	2026-06-24 14:40:10.205+00	aPIt4olssUNlg54wUoGuHchKJx4gR3JH	2026-06-17 14:40:10.205+00	2026-06-17 14:40:10.205+00	2404:00c0:c204:63c5:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/149.0.7827.55 Safari/537.36	8vw0ltUCxfFLtMse1NeIYzGaMiBBRdoB
o6Z591xVxkqCMdfQVQ2Ik9uGkOeRWr68	2026-06-24 14:40:57.716+00	itnD42WhnVN7N48tIfDPhlLVaEJMP7eR	2026-06-17 14:40:57.717+00	2026-06-17 14:40:57.717+00	2404:00c0:c204:63c5:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/149.0.7827.55 Safari/537.36	8vw0ltUCxfFLtMse1NeIYzGaMiBBRdoB
Je0KurC2m6zFK4tMz1SHgHXzFRgklXxY	2026-06-24 14:44:11.122+00	3w47YOjUl4gaqQiFoDQrtXVTLfAq0D9R	2026-06-17 14:44:11.123+00	2026-06-17 14:44:11.123+00	2404:00c0:c204:63c5:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/149.0.7827.55 Safari/537.36	8vw0ltUCxfFLtMse1NeIYzGaMiBBRdoB
MZ6ba1LETtUu0NNUlymSEleon9d7uN0t	2026-06-24 14:44:33.083+00	WGdOccZ0fGefgAriGygNDTJkNVNcWq51	2026-06-17 14:44:33.083+00	2026-06-17 14:44:33.083+00	2404:00c0:c204:63c5:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/149.0.7827.55 Safari/537.36	8vw0ltUCxfFLtMse1NeIYzGaMiBBRdoB
czZj7pb1uVyGg5adLbyuIRaRXPnAoMEB	2026-06-24 14:45:35.205+00	ABUfTLHj4MZ6ZtwZpqdDAxHIDvoiZq41	2026-06-17 14:45:35.205+00	2026-06-17 14:45:35.205+00	2404:00c0:c204:63c5:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/149.0.7827.55 Safari/537.36	8vw0ltUCxfFLtMse1NeIYzGaMiBBRdoB
bv03lT9HvIq7L8dTNqeru8Iz2ZXoM8Tz	2026-06-24 14:45:58.137+00	hOHRPvjYpnbogHFuZy8jD7xGDUogw70X	2026-06-17 14:45:58.138+00	2026-06-17 14:45:58.138+00	2404:00c0:c204:63c5:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/149.0.7827.55 Safari/537.36	8vw0ltUCxfFLtMse1NeIYzGaMiBBRdoB
Fb7D67WDq5oMNzryMVbvDulojTBPkJNz	2026-06-24 14:46:33.921+00	7jCE7UwmQ7Jma4M4yKFqmgvWCESThKmH	2026-06-17 14:46:33.921+00	2026-06-17 14:46:33.921+00	2404:00c0:c204:63c5:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/149.0.7827.55 Safari/537.36	8vw0ltUCxfFLtMse1NeIYzGaMiBBRdoB
nANeRWpy4os8x2sO1rGnyXKY7qDBKJ2n	2026-06-24 14:47:35.253+00	mDfIB8nsrUkProYm3cSiMWA2sZbc15A7	2026-06-17 14:47:35.253+00	2026-06-17 14:47:35.253+00	2404:00c0:c204:63c5:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/149.0.7827.55 Safari/537.36	8vw0ltUCxfFLtMse1NeIYzGaMiBBRdoB
2irUtNLnvUlLl0K49pLf7xgXvyFo9NjM	2026-06-24 16:03:48.772+00	TAKnxQMPttGBr1FRITyl2LfOgtQRxjYV	2026-06-17 16:03:48.773+00	2026-06-17 16:03:48.773+00	182.8.131.174	Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36	fsD8l2mMnLbEQ35CvZLkQYrR8pJz6WE0
TV9QQDSC4ev4O4rv5T0bXim5SF2EZFtx	2026-06-25 01:13:36.946+00	L96AvQaTrVEHMvZuVoPfT9cHCulxgDh6	2026-06-18 01:13:36.947+00	2026-06-18 01:13:36.947+00	2404:00c0:c204:0e9c:0000:0000:0000:0000	Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1	8vw0ltUCxfFLtMse1NeIYzGaMiBBRdoB
g2BhPWG1o4xHtwZxbzAEdZJSFILdWBd4	2026-06-25 01:20:52.057+00	cAa6c850pHFhOTbyODELpddrzf6w2swk	2026-06-18 01:20:52.057+00	2026-06-18 01:20:52.057+00	2404:00c0:c204:0e9c:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36	8vw0ltUCxfFLtMse1NeIYzGaMiBBRdoB
qkAdQuWjV6yp3XDPsIkgw0FkAC20zVCm	2026-06-25 07:27:11.146+00	LC8S02QwZ6tTlUpgvEi8PfRPFiGxhgqd	2026-06-18 07:27:11.146+00	2026-06-18 07:27:11.146+00	2404:00c0:c203:23d6:0000:0000:0000:0000	Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36	8vw0ltUCxfFLtMse1NeIYzGaMiBBRdoB
7AII46hddChaVN4tZDKz1BCVbGeWLrgy	2026-06-26 01:32:11.87+00	0Y2kW8Tgyy5lGv8XMPAyXI1BWGbTyXP5	2026-06-19 01:32:11.87+00	2026-06-19 01:32:11.87+00	2404:00c0:c203:23d6:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36	8vw0ltUCxfFLtMse1NeIYzGaMiBBRdoB
g4q0wurDfRBjKcSxnE0FXyS6VYzlEWvD	2026-06-26 09:54:47.789+00	rThhumSTZ6mF46GNVrXPgZByCKsl5UDi	2026-06-19 09:54:47.79+00	2026-06-19 09:54:47.79+00	103.108.31.110	Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36	fsD8l2mMnLbEQ35CvZLkQYrR8pJz6WE0
7tuA4chDS0GHDkr1B2jhuwDGTmF0xqDB	2026-06-26 11:04:18.353+00	rjO9yrrrgt7rSQVyfx8KK2EjIE3hfSJk	2026-06-19 11:04:18.353+00	2026-06-19 11:04:18.353+00	103.108.31.110	Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36	8vw0ltUCxfFLtMse1NeIYzGaMiBBRdoB
maKOD4F8DtDlqAjJHxtYcB3kIWhNOuYz	2026-06-26 11:10:15.551+00	VnVfze5BGWVyl2vMriP0hYX6rRXObj2G	2026-06-19 11:10:15.551+00	2026-06-19 11:10:15.551+00	2404:00c0:c203:4d6a:0000:0000:0000:0000	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36	fsD8l2mMnLbEQ35CvZLkQYrR8pJz6WE0
\.


ALTER TABLE public.session ENABLE TRIGGER ALL;

--
-- Data for Name: verification; Type: TABLE DATA; Schema: public; Owner: rizkgin
--

ALTER TABLE public.verification DISABLE TRIGGER ALL;

COPY public.verification (id, identifier, value, expires_at, created_at, updated_at) FROM stdin;
\.


ALTER TABLE public.verification ENABLE TRIGGER ALL;

--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE SET; Schema: drizzle; Owner: rizkgin
--

SELECT pg_catalog.setval('drizzle.__drizzle_migrations_id_seq', 1, true);


--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: rizkgin
--

SELECT pg_catalog.setval('public.__drizzle_migrations_id_seq', 20, true);


--
-- Name: admins_id_seq; Type: SEQUENCE SET; Schema: public; Owner: rizkgin
--

SELECT pg_catalog.setval('public.admins_id_seq', 1, false);


--
-- Name: cashFlows_id_seq; Type: SEQUENCE SET; Schema: public; Owner: rizkgin
--

SELECT pg_catalog.setval('public."cashFlows_id_seq"', 13, true);


--
-- Name: cashInCategory_id_seq; Type: SEQUENCE SET; Schema: public; Owner: rizkgin
--

SELECT pg_catalog.setval('public."cashInCategory_id_seq"', 14, true);


--
-- Name: cashInDetailTable_id_seq; Type: SEQUENCE SET; Schema: public; Owner: rizkgin
--

SELECT pg_catalog.setval('public."cashInDetailTable_id_seq"', 10, true);


--
-- Name: cashOutCategory_id_seq; Type: SEQUENCE SET; Schema: public; Owner: rizkgin
--

SELECT pg_catalog.setval('public."cashOutCategory_id_seq"', 20, true);


--
-- Name: cashOutDetailTable_id_seq; Type: SEQUENCE SET; Schema: public; Owner: rizkgin
--

SELECT pg_catalog.setval('public."cashOutDetailTable_id_seq"', 3, true);


--
-- Name: courier_sessions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: rizkgin
--

SELECT pg_catalog.setval('public.courier_sessions_id_seq', 5, true);


--
-- Name: couriers_id_seq; Type: SEQUENCE SET; Schema: public; Owner: rizkgin
--

SELECT pg_catalog.setval('public.couriers_id_seq', 37, true);


--
-- Name: customers_id_seq; Type: SEQUENCE SET; Schema: public; Owner: rizkgin
--

SELECT pg_catalog.setval('public.customers_id_seq', 35, true);


--
-- Name: locations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: rizkgin
--

SELECT pg_catalog.setval('public.locations_id_seq', 3, true);


--
-- Name: orderDetails_id_seq; Type: SEQUENCE SET; Schema: public; Owner: rizkgin
--

SELECT pg_catalog.setval('public."orderDetails_id_seq"', 18, true);


--
-- Name: outlets_id_seq; Type: SEQUENCE SET; Schema: public; Owner: rizkgin
--

SELECT pg_catalog.setval('public.outlets_id_seq', 5, true);


--
-- Name: product_ads_id_seq; Type: SEQUENCE SET; Schema: public; Owner: rizkgin
--

SELECT pg_catalog.setval('public.product_ads_id_seq', 7, true);


--
-- Name: product_ads_schedule_id_seq; Type: SEQUENCE SET; Schema: public; Owner: rizkgin
--

SELECT pg_catalog.setval('public.product_ads_schedule_id_seq', 61, true);


--
-- Name: promos_id_seq; Type: SEQUENCE SET; Schema: public; Owner: rizkgin
--

SELECT pg_catalog.setval('public.promos_id_seq', 1, false);


--
-- Name: schedule_product_ads_id_seq; Type: SEQUENCE SET; Schema: public; Owner: rizkgin
--

SELECT pg_catalog.setval('public.schedule_product_ads_id_seq', 168, true);


--
-- PostgreSQL database dump complete
--

\unrestrict 4iOoGeR6IZMLffCj9hzFQRtbgh3ALeLLKrxlQi5K8DE3kVexHHBQ47o2OIeMbZY

