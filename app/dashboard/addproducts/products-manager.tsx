"use client";

import { useState, useRef, useEffect } from "react";
import { Plus, ArrowLeft, Coffee, Pizza, Cookie, Package, Layers, Tag, DollarSign, Loader2, Image as ImageIcon, Edit, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addProductAction, AddProductInput, uploadImage, deleteProductAction, updateProductAction } from "./actions";
import Image from "next/image";
import { DashboardHeader } from "@/components/dashboard-header";

type Product = {
    id: string;
    product_name: string;
    price: string;
    price_mark_down: string;
    category: string;
    image: string;
    isAvailable: boolean;
    description: string | null;
    unit: string;
};

type ProductsManagerProps = {
    outletId: number;
    initialProducts: Product[];
};

const CATEGORIES = [
    { id: "Food", label: "Food", icon: Pizza, color: "text-orange-500", bg: "bg-orange-50", border: "border-orange-100" },
    { id: "Beverage", label: "Beverage", icon: Coffee, color: "text-amber-600", bg: "bg-amber-50", border: "border-amber-100" },
    { id: "Snack", label: "Snack", icon: Cookie, color: "text-amber-500", bg: "bg-amber-50", border: "border-amber-100" },
    { id: "Other", label: "Other", icon: Package, color: "text-blue-500", bg: "bg-blue-50", border: "border-blue-100" },
];

export const ProductsManager = ({ outletId, initialProducts }: ProductsManagerProps) => {
    const [view, setView] = useState<"list" | "category" | "form">("list");
    const [selectedCategory, setSelectedCategory] = useState<string>("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [imageUrl, setImageUrl] = useState<string>("");
    const [editingProductId, setEditingProductId] = useState<string | null>(null);

    // Form State
    const [formData, setFormData] = useState({
        product_name: "",
        price: "",
        price_mark_down: "",
        description: "",
        unit: "pcs",
    });

    const handleCategorySelect = (category: string) => {
        setSelectedCategory(category);
        setView("form");
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);

        const data: AddProductInput = {
            ...formData,
            category: selectedCategory,
            outletId: outletId, // Correctly using outletId
        } as any;

        let result;
        if (editingProductId) {
            result = await updateProductAction(editingProductId, {
                ...formData,
                category: selectedCategory,
                image: imageUrl,
            });
        } else {
            result = await addProductAction({
                ...formData,
                category: selectedCategory,
                outlet_id: outletId,
                image: imageUrl,
            });
        }

        setIsSubmitting(false);

        if (result.success) {
            // Reset and go back to list
            setFormData({
                product_name: "",
                price: "",
                price_mark_down: "",
                description: "",
                unit: "pcs",
            });
            setImageUrl("");
            setEditingProductId(null);
            setView("list");
        } else {
            alert(result.message);
        }
    };

    const handleEdit = (product: Product) => {
        if (product.image === 'avatar.png') {
            setImageUrl('/avatar.png')
            product.image = '/avatar.png';
        } else {
            setImageUrl(product.image)
        }
        setEditingProductId(product.id);
        setSelectedCategory(product.category);
        setFormData({
            product_name: product.product_name,
            price: product.price,
            price_mark_down: product.price_mark_down,
            description: product.description || "",
            unit: product.unit,
        });
        setImageUrl(product.image);
        setView("form");
    };

    const handleDelete = async (id: string) => {
        if (!window.confirm("Are you sure you want to delete this product?")) return;
        setIsSubmitting(true);
        const result = await deleteProductAction(id);
        setIsSubmitting(false);
        if (!result.success) {
            alert(result.message);
        }
    };

    //handle Image Upload

    const ImageInputRef = useRef<HTMLInputElement>(null);

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const formData = new FormData();
            formData.append("image", file);

            const result = await uploadImage(formData);
            if (result.success && result.imageUrl) {
                setImageUrl(result.imageUrl);
            }
        }
    }

    useEffect(() => {
        if (initialProducts.length > 0) {
            setView("list");
        } else {
            setView("category");
        }
    }, [initialProducts]);

    return (
        <div className="space-y-6 mt-4">
            {view === "list" && (
                <>
                    <div className="flex items-center justify-between mb-8">
                        <div>
                            <h2 className="text-3xl font-extrabold tracking-tight text-foreground">Your Products</h2>
                            <p className="text-muted-foreground mt-1">Manage inventory across your outlet.</p>
                        </div>
                        <Button
                            onClick={() => {
                                setEditingProductId(null);
                                setFormData({
                                    product_name: "",
                                    price: "",
                                    price_mark_down: "",
                                    description: "",
                                    unit: "pcs",
                                });
                                setImageUrl("");
                                setView("category");
                            }}
                            className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-lg shadow-blue-600/20 transition-all hover:scale-105"
                        >
                            <Plus className="mr-2 h-5 w-5" />
                            Add Product
                        </Button>
                    </div>

                    {initialProducts.length === 0 ? (
                        <div className="flex flex-col items-center justify-center p-12 border-2 border-dashed rounded-3xl bg-muted/10">
                            <div className="p-4 rounded-full bg-blue-50 text-blue-500 mb-4">
                                <Package className="h-8 w-8" />
                            </div>
                            <h3 className="text-xl font-bold text-foreground">No Products Yet</h3>
                            <p className="text-muted-foreground max-w-sm text-center mt-2 mb-6">
                                Start building your inventory by adding your first product.
                            </p>
                            <Button onClick={() => setView("category")} variant="outline" className="rounded-xl border-dashed hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 transition-colors">
                                Add Your First Product
                            </Button>
                        </div>
                    ) : (
                        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                            {initialProducts.map((product) => (
                                <div key={product.id} className="group relative overflow-hidden rounded-2xl border bg-background p-5 transition-all hover:shadow-xl hover:border-blue-600/30 flex flex-col h-full">
                                    <div className="absolute top-4 right-4 z-10 flex gap-2">
                                        <button
                                            onClick={() => handleEdit(product)}
                                            className="p-1.5 rounded-lg bg-background/80 backdrop-blur shadow-sm border text-muted-foreground hover:text-blue-600 hover:border-blue-200 transition-colors opacity-0 group-hover:opacity-100"
                                        >
                                            <Edit className="h-4 w-4" />
                                        </button>
                                        <button
                                            onClick={() => handleDelete(product.id)}
                                            disabled={isSubmitting}
                                            className="p-1.5 rounded-lg bg-background/80 backdrop-blur shadow-sm border text-muted-foreground hover:text-rose-600 hover:border-rose-200 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-50"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                    <div className="absolute top-4 left-4 z-10">
                                        <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider shadow-sm backdrop-blur bg-background/80 ${product.isAvailable ? 'text-emerald-700' : 'text-rose-700'}`}>
                                            {product.isAvailable ? 'In Stock' : 'Out of Stock'}
                                        </span>
                                    </div>
                                    <div className="relative aspect-square rounded-xl bg-muted/30 mb-4 flex items-center justify-center overflow-hidden border">
                                        {product.image && product.image !== "avatar.png" ? (
                                            <Image src={product.image} fill className="object-cover group-hover:scale-110 transition-transform duration-500" alt={product.product_name} />
                                        ) : (
                                            <Package className="h-12 w-12 text-muted-foreground/50 group-hover:scale-110 transition-transform duration-500" />
                                        )}
                                    </div>
                                    <div className="flex-1 flex flex-col">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                                                {product.category}
                                            </span>
                                        </div>
                                        <h3 className="font-bold text-lg leading-tight line-clamp-2 mb-2 group-hover:text-blue-600 transition-colors">
                                            {product.product_name}
                                        </h3>
                                        <div className="mt-auto pt-4 flex items-end gap-2 border-t border-muted/50">
                                            <span className="text-xl font-extrabold tracking-tight">Rp {product.price}</span>
                                            {product.price_mark_down && product.price_mark_down !== "0" && (
                                                <span className="text-sm font-medium text-muted-foreground line-through mb-0.5">
                                                    Rp {product.price_mark_down}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}

            {view === "category" && (
                <div className="max-w-4xl mx-auto">
                    <Button
                        variant="ghost"
                        onClick={() => setView("list")}
                        className="mb-6 hover:bg-muted/50 text-muted-foreground hover:text-foreground -ml-4 rounded-xl"
                    >
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back to Products
                    </Button>

                    <div className="mb-8 text-center">
                        <h2 className="text-3xl font-extrabold tracking-tight text-foreground">Choose Category</h2>
                        <p className="text-muted-foreground mt-2 text-lg">What kind of product are you adding?</p>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
                        {CATEGORIES.map((cat) => (
                            <button
                                key={cat.id}
                                onClick={() => handleCategorySelect(cat.id)}
                                className={`flex flex-col items-center justify-center p-8 rounded-3xl border-2 transition-all hover:-translate-y-1 hover:shadow-xl bg-background ${cat.border} hover:border-blue-500 group relative overflow-hidden`}
                            >
                                <div className={`p-4 rounded-2xl ${cat.bg} ${cat.color} mb-4 group-hover:scale-110 transition-transform duration-300 relative z-10 shadow-sm`}>
                                    <cat.icon className="h-10 w-10" />
                                </div>
                                <span className="font-bold text-lg text-foreground relative z-10 group-hover:text-blue-600 transition-colors">{cat.label}</span>
                                <div className="absolute inset-0 bg-gradient-to-b from-transparent to-muted/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {view === "form" && (
                <div className="max-w-2xl mx-auto">
                    <Button
                        variant="ghost"
                        onClick={() => setView("category")}
                        className="mb-6 hover:bg-muted/50 text-muted-foreground hover:text-foreground -ml-4 rounded-xl"
                    >
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back to Categories
                    </Button>

                    <div className="bg-background border rounded-3xl p-8 shadow-sm relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-blue-500 to-purple-500" />

                        <div className="flex items-center gap-4 mb-8">
                            <div className="p-3 rounded-xl bg-blue-50 text-blue-600">
                                <Package className="h-6 w-6" />
                            </div>
                            <div>
                                <h2 className="text-2xl font-bold tracking-tight">{editingProductId ? 'Edit' : 'Add New'} {selectedCategory}</h2>
                                <p className="text-muted-foreground text-sm font-medium">Fill in the details below to {editingProductId ? 'update' : 'add to'} your inventory.</p>
                            </div>
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-6">
                            <div className="space-y-2">
                                <label className="text-sm font-bold flex items-center gap-2">
                                    <Tag className="h-4 w-4 text-muted-foreground" />
                                    Product Name
                                </label>
                                <input
                                    required
                                    name="product_name"
                                    value={formData.product_name}
                                    onChange={handleInputChange}
                                    className="flex h-12 w-full rounded-xl border border-input bg-transparent px-4 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                                    placeholder="e.g. Signature Iced Latte"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <label className="text-sm font-bold flex items-center gap-2">
                                        <DollarSign className="h-4 w-4 text-muted-foreground" />
                                        Normal Price
                                    </label>
                                    <div className="relative">
                                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">Rp</span>
                                        <input
                                            required
                                            name="price"
                                            type="number"
                                            value={formData.price}
                                            onChange={handleInputChange}
                                            className="flex h-12 w-full rounded-xl border border-input bg-transparent pl-12 pr-4 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                                            placeholder="25000"
                                        />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-bold flex items-center gap-2 text-emerald-600">
                                        <DollarSign className="h-4 w-4" />
                                        Discount Price
                                    </label>
                                    <div className="relative">
                                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-emerald-600/70 font-medium">Rp</span>
                                        <input
                                            required
                                            name="price_mark_down"
                                            type="number"
                                            value={formData.price_mark_down}
                                            onChange={handleInputChange}
                                            className="flex h-12 w-full rounded-xl border border-emerald-200 bg-emerald-50/30 pl-12 pr-4 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                                            placeholder="20000"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-bold flex items-center gap-2">
                                    <Layers className="h-4 w-4 text-muted-foreground" />
                                    Description
                                </label>
                                <textarea
                                    name="description"
                                    value={formData.description}
                                    onChange={handleInputChange}
                                    className="flex min-h-[100px] w-full rounded-xl border border-input bg-transparent px-4 py-3 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 resize-none"
                                    placeholder="Describe your product..."
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-bold flex items-center gap-2">
                                    <ImageIcon className="h-4 w-4 text-muted-foreground" />
                                    Product Image
                                </label>
                                {imageUrl ? (
                                    console.log(imageUrl),
                                    <div className="relative w-full h-48 rounded-xl overflow-hidden border">
                                        <Image src={imageUrl} fill className="object-cover" alt="Product Image Preview" />
                                        <Button
                                            type="button"
                                            variant="destructive"
                                            size="sm"
                                            className="absolute top-2 right-2 rounded-xl shadow-md"
                                            onClick={() => setImageUrl("")}
                                        >
                                            Remove
                                        </Button>
                                    </div>
                                ) : (
                                    <input
                                        type="file"
                                        name="image"
                                        accept="image/*"
                                        ref={ImageInputRef}
                                        onChange={handleImageUpload}
                                        className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-xl border-blue-200 bg-blue-50/50 hover:bg-blue-50 transition-colors text-blue-600 font-bold p-4 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                                    />
                                )}
                            </div>
                            <div className="pt-4 flex justify-end">
                                <Button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className="w-full sm:w-auto px-8 rounded-xl bg-blue-600 hover:bg-blue-700 h-12 text-md font-bold shadow-lg shadow-blue-600/20"
                                >
                                    {isSubmitting ? (
                                        <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Saving...</>
                                    ) : (
                                        editingProductId ? 'Update Product' : 'Publish Product'
                                    )}
                                </Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};
