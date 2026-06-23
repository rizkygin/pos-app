'use client'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { MessageCircle } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import Image from "next/image"

export const MessageChatComponent = () => {
    return (
        <motion.div
            drag
            dragMomentum={false}
            className="fixed bottom-12 right-8 z-50"
            style={{ touchAction: "none" }}
        >
            <Collapsible className="relative flex flex-row-reverse items-end">
                <CollapsibleTrigger asChild>
                    <div className="cursor-move flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-all hover:scale-110 hover:shadow-xl active:scale-95 z-50 shrink-0">
                        <MessageCircle className="h-6 w-6 pointer-events-none" />
                    </div>
                </CollapsibleTrigger>
                <CollapsibleContent asChild>
                    <AnimatePresence>
                        <motion.div
                            initial={{ opacity: 0, y: 20, scale: 0.9 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 20, scale: 0.9 }}
                            transition={{ duration: 0.2 }}
                            className="absolute bottom-0 right-16 z-40 w-[300px] h-[400px] bg-background border rounded-xl shadow-2xl p-4 origin-bottom-right"
                        >
                            {/* Placeholder for chat content */}
                            <h3 className="font-semibold text-sm mb-2">Chat</h3>
                            <span className="text-sm opacity-50">Will Available Soon !</span>
                            <div className="relative w-[100px] h-[100px] mt-4 rounded-xl overflow-hidden">
                                <Image src="/sinchan2.jpg" alt="Sinchan" fill className="object-cover" />
                            </div>
                        </motion.div>
                    </AnimatePresence>
                </CollapsibleContent>
            </Collapsible>
        </motion.div>
    )
}

export default MessageChatComponent;