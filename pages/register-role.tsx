'use client'
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRouter } from "next/navigation";

const roles = [
    {
        id: "customer",
        title: "Customer",
        description: "Belanja barang barang favorite di area sekitar mu.",
        image: "/illustrations/customer.png",
    },
    {
        id: "owner",
        title: "Pemilik Resto",
        description: "Mengatur Bisnis, Pantau Penjualan, dan Kembangkan Restoran Anda dengan Mudah.",
        image: "/illustrations/outlet-owner.png",
    },
    {
        id: "courier",
        title: "Kurir",
        description: "Mengantar pesanan barang.",
        image: "/illustrations/courier.png",
    }

];

const RegistrationForm = ({ role, onCancel }: { role: string, onCancel: () => void }) => {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState<any>({});

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const res = await fetch("/api/register-role", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ role, data: formData }),
            });
            if (res.ok) {
                router.push("/dashboard");
            } else {
                const data = await res.json();
                alert(data.error || "Something went wrong");
            }
        } catch (err) {
            alert("Failed to register");
        } finally {
            setLoading(false);
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    return (
        <motion.div
            layoutId={role}
            className="w-full max-w-lg bg-card border border-border/50 shadow-2xl rounded-[2.5rem] p-8 md:p-12 space-y-8 relative overflow-hidden"
        >
            <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none" />

            <div className="flex items-center justify-between relative z-10">
                <div className="flex items-center gap-4">
                    <div className="relative w-16 h-16 rounded-2xl overflow-hidden bg-muted">
                        <Image
                            src={roles.find(r => r.id === role)?.image || ""}
                            alt={role}
                            fill
                            className="object-cover"
                        />
                    </div>
                    <div>
                        <h2 className="text-2xl font-bold">Register as {roles.find(r => r.id === role)?.title}</h2>
                        <p className="text-sm text-muted-foreground">Please fill in your details</p>
                    </div>
                </div>
                <Button variant="ghost" size="icon" onClick={onCancel} className="rounded-full">
                    ✕
                </Button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6 relative z-10">
                {role === 'owner' && (
                    <>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Outlet Name</label>
                            <Input name="name" onChange={handleChange} required placeholder="My Awesome Store" className="rounded-xl" />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Address</label>
                            <Input name="address" onChange={handleChange} required placeholder="123 Street Name" className="rounded-xl" />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Phone</label>
                                <Input name="phone" onChange={handleChange} required placeholder="08..." className="rounded-xl" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Email</label>
                                <Input name="email" type="email" onChange={handleChange} required placeholder="store@example.com" className="rounded-xl" />
                            </div>
                        </div>
                    </>
                )}

                {role === 'courier' && (
                    <>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Nomor Plat Kendaraan</label>
                            <Input name="vehicle_plate" onChange={handleChange} required placeholder="B 1234 ABC" className="rounded-xl" />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Jenis Kendaraan</label>
                            <select name="vehicle_type" onChange={handleChange} required className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
                                <option value="motorcycle">Motoran</option>
                                <option value="car">Bemobil</option>
                            </select>
                        </div>
                    </>
                )}

                {role === 'customer' && (
                    <div className="py-8 text-center space-y-4">
                        <p className="text-muted-foreground">Tidak ada informasi tambahan yang diperlukan. Siap untuk mulai berbelanja?</p>
                    </div>
                )}

                <div className="flex gap-4 pt-4">
                    <Button type="button" variant="outline" onClick={onCancel} className="flex-1 rounded-2xl py-6 transition-all hover:bg-muted">
                        Batal
                    </Button>
                    <Button type="submit" disabled={loading} className="flex-1 rounded-2xl py-6 font-bold shadow-lg shadow-primary/20 transition-all hover:scale-[1.02]">
                        {loading ? "Mendaftar..." : "Selesai Daftar"}
                    </Button>
                </div>
            </form>
        </motion.div>
    );
};


const RoleCard = ({ role, index, onSelect }: { role: typeof roles[0], index: number, onSelect: () => void }) => {
    return (
        <motion.div
            layoutId={role.id}
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: index * 0.15 }}
            whileHover={{ y: -10, transition: { duration: 0.2 } }}
            className="group relative flex flex-col items-center p-8 rounded-[2.5rem] bg-card border border-border/50 shadow-xl hover:shadow-2xl transition-all duration-300 w-full max-w-[360px] overflow-hidden cursor-default"
        >
            <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

            <div className="relative z-10 w-full aspect-square mb-8 overflow-hidden rounded-2xl bg-muted/30 pointer-events-none">
                <Image
                    src={role.image}
                    alt={role.title}
                    fill
                    className="object-cover transform group-hover:scale-110 transition-transform duration-500"
                />
            </div>

            <div className="relative z-10 text-center space-y-4 flex-grow pointer-events-none">
                <h3 className="text-2xl font-bold tracking-tight">{role.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                    {role.description}
                </p>
            </div>

            <div className="relative z-20 w-full mt-8">
                <Button
                    onClick={(e) => {
                        console.log("Register button clicked for role:", role.id);
                        e.preventDefault();
                        e.stopPropagation();
                        onSelect();
                    }}
                    className="w-full rounded-2xl py-6 text-base font-semibold group-hover:scale-[1.02] transition-transform relative z-30"
                >
                    Register as {role.title.split(' ').pop()}
                </Button>
            </div>
        </motion.div>
    );
};


export const RegisterRolePage = () => {
    const [selectedRole, setSelectedRole] = useState<string | null>(null);

    const handleSelect = (roleId: string) => {
        console.log("Setting selected role to:", roleId);
        setSelectedRole(roleId);
    };

    return (
        <div className="min-h-screen bg-background flex items-center justify-center p-6 md:p-12 overflow-x-hidden">
            {/* Background Decor */}
            <div className="fixed inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] bg-primary/5 blur-[120px] rounded-full" />
                <div className="absolute -bottom-[10%] -right-[10%] w-[40%] h-[40%] bg-blue-500/5 blur-[120px] rounded-full" />
            </div>

            <div className="relative z-10 w-full max-w-7xl flex flex-col items-center gap-12">
                <AnimatePresence>
                    {!selectedRole ? (
                        <motion.div
                            key="selection"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
                            className="flex flex-col items-center gap-12"
                        >
                            <div className="text-center space-y-4">
                                <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70 pb-2">
                                    Pilih Peranmu
                                </h1>
                                <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                                    Pilih peran yang sesuai dengan kebutuhanmu dan mulai berbisnis dengan Ulun Pesan.
                                </p>
                            </div>

                            <div className="flex flex-col lg:flex-row items-stretch justify-center gap-8 w-full max-w-screen-xl">
                                {roles.map((role, index) => (
                                    <RoleCard key={role.id} role={role} index={index} onSelect={() => handleSelect(role.id)} />
                                ))}
                            </div>
                        </motion.div>
                    ) : (
                        <motion.div
                            key="form"
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            className="w-full flex justify-center"
                        >
                            <RegistrationForm role={selectedRole} onCancel={() => setSelectedRole(null)} />
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
};


export default RegisterRolePage;